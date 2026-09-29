import type { CopilotClient, SessionConfig } from "@github/copilot-sdk";
import { z } from "zod";
import { Count, Id } from "../../contracts/src/index.js";
import { assertExecutionDisabled, ModelSettings } from "./manifest.js";

export const ModelRequest = z.strictObject({
  requestId: Id,
  settings: ModelSettings,
  prompt: z.string().min(1),
  maxOutputTokens: Count.positive(),
  timeoutMs: Count.positive()
});
const UsageEvent = z.object({
  model: z.string().optional(),
  inputTokens: Count.optional(),
  outputTokens: Count.optional(),
  cost: z.number().finite().nonnegative().optional()
});
export interface ModelResponse {
  kind: "real-inference" | "offline-test-double";
  content: string;
  modelId: string;
  usage: { inputTokens: number | null; outputTokens: number | null; aiCredits: number | null; currencyCost: null };
}
export interface ModelTransport {
  readonly kind: ModelResponse["kind"];
  generate(request: unknown): Promise<ModelResponse>;
}
export interface SdkSessionPort {
  onUsage(listener: (event: unknown) => void): () => void;
  send(prompt: string, timeoutMs: number): Promise<string | undefined>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}
export interface SdkClientPort {
  createSession(config: SessionConfig): Promise<SdkSessionPort>;
  stop(): Promise<Error[]>;
}

export function copilotSessionConfig(input: unknown): SessionConfig {
  const request = ModelRequest.parse(input);
  if (request.settings.reasoning === "none" || request.settings.reasoning === "minimal") {
    throw new Error("SDK_REASONING_UNSUPPORTED: pinned SDK types cannot represent this exact setting");
  }
  return {
    model: request.settings.id,
    reasoningEffort: request.settings.reasoning,
    contextTier: request.settings.context,
    reasoningSummary: "none",
    availableTools: [],
    excludedTools: ["builtin:*", "mcp:*", "custom:*"],
    tools: [],
    mcpServers: {},
    customAgents: [],
    skillDirectories: [],
    includedBuiltinSkills: [],
    enableConfigDiscovery: false,
    enableSessionStore: false,
    infiniteSessions: { enabled: false },
    onPermissionRequest: () => ({ kind: "denied-by-permission-request-hook", message: "Transport has no tool authority" })
  };
}

// Maps the pinned SDK surface; construction alone starts no process or session.
export function wrapCopilotSdk(client: Pick<CopilotClient, "createSession" | "stop">): SdkClientPort {
  return {
    async createSession(config) {
      const session = await client.createSession(config);
      return {
        onUsage: (listener) => session.on("assistant.usage", (event) => { listener(event.data); }),
        send: async (prompt, timeout) => (await session.sendAndWait({ prompt }, timeout))?.data.content,
        abort: () => session.abort(),
        disconnect: () => session.disconnect()
      };
    },
    stop: () => client.stop()
  };
}

export class BlockedCopilotTransport implements ModelTransport {
  readonly kind = "real-inference" as const;
  async generate(input: unknown): Promise<ModelResponse> {
    ModelRequest.parse(input);
    return assertExecutionDisabled();
  }
}

export interface OfflineSdkDouble extends SdkClientPort {
  readonly kind: "offline-test-double";
}

export async function exerciseOfflineSdkProtocol(input: unknown, double: OfflineSdkDouble): Promise<ModelResponse> {
  const request = ModelRequest.parse(input);
  if (double.kind !== "offline-test-double") throw new Error("Only explicitly labeled offline doubles are accepted");
  const events: z.infer<typeof UsageEvent>[] = [];
  let session: SdkSessionPort | undefined;
  let unsubscribe: (() => void) | undefined;
  const errors: unknown[] = [];
  let content: string | undefined;
  try {
    session = await double.createSession(copilotSessionConfig(request));
    unsubscribe = session.onUsage((event) => { events.push(UsageEvent.parse(event)); });
    content = await session.send(request.prompt, request.timeoutMs);
    if (!content?.trim()) throw new Error("MODEL_EMPTY_RESPONSE");
    if (events.some((e) => e.model !== undefined && e.model !== request.settings.id)) throw new Error("MODEL_ID_MISMATCH");
    const output = events.reduce((sum, e) => sum + (e.outputTokens ?? 0), 0);
    if (output > request.maxOutputTokens) throw new Error("MODEL_OUTPUT_LIMIT_EXCEEDED");
  } catch (error) {
    errors.push(error);
    if (session) {
      try { await session.abort(); } catch (abortError) { errors.push(abortError); }
    }
  } finally {
    unsubscribe?.();
    if (session) {
      try { await session.disconnect(); } catch (disconnectError) { errors.push(disconnectError); }
    }
    try { errors.push(...await double.stop()); } catch (stopError) { errors.push(stopError); }
  }
  if (errors.length) throw new AggregateError(errors, "Offline SDK protocol failed; no fallback result");
  if (!content) throw new Error("MODEL_EMPTY_RESPONSE");
  const total = (key: "inputTokens" | "outputTokens" | "cost"): number | null =>
    !events.length || events.some((event) => event[key] === undefined) ? null :
      events.reduce((sum, event) => sum + (event[key] ?? 0), 0);
  return {
    kind: "offline-test-double", content, modelId: request.settings.id,
    usage: { inputTokens: total("inputTokens"), outputTokens: total("outputTokens"), aiCredits: total("cost"), currencyCost: null }
  };
}
