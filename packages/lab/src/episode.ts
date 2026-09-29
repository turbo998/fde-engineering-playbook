import { z } from "zod";
import { Count, Id, Timestamp } from "../../contracts/src/index.js";
import { TestAcknowledgement, TestApprovalCommand, TestCapabilities, TestEvent } from "../../contracts/src/test-adapter.js";
import { Observation, Oracle, evaluate } from "./evaluator.js";
import { Dataset, Simulator } from "./simulator.js";
import { digest } from "./encoding.js";

const ExpectedReply = z.strictObject({
  httpStatus: z.union([z.literal(200), z.literal(202), z.literal(400), z.literal(403), z.literal(409), z.literal(503)]),
  status: TestAcknowledgement.shape.status
});
export const EpisodeScript = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("offline-protocol-test"),
  id: Id,
  dataset: Dataset,
  steps: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("event"), event: TestEvent, expected: ExpectedReply }),
    z.strictObject({ kind: z.literal("approval"), command: TestApprovalCommand, sessionRef: Id, expected: ExpectedReply }),
    z.strictObject({ kind: z.literal("restart") }),
    z.strictObject({ kind: z.literal("advance-clock"), at: Timestamp })
  ])).min(1),
  oracle: Oracle,
  additionalAssertions: z.array(z.string().min(1))
});
type Reply = { httpStatus: number; acknowledgement: z.infer<typeof TestAcknowledgement> };
class ProtocolError extends Error {}

export interface ApplicationTestAdapter {
  readonly kind: "offline-test-double" | "candidate";
  connect(): Promise<void>;
  event(event: z.infer<typeof TestEvent>): Promise<Reply>;
  approval(command: z.infer<typeof TestApprovalCommand>, sessionRef: string): Promise<Reply>;
  restart(): Promise<void>;
  observe(): Promise<z.infer<typeof Observation>>;
}

function loopback(input: string): URL {
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/?$/.test(input)) throw new Error("ADAPTER_LOOPBACK_ORIGIN_REQUIRED");
  const url = new URL(input);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("ADAPTER_LOOPBACK_ORIGIN_REQUIRED");
  }
  return url;
}

export class OfflineHttpAdapter implements ApplicationTestAdapter {
  readonly kind = "offline-test-double" as const;
  private origin: URL;
  constructor(origin: string, private readonly lifecycle: { restart(): Promise<string> }, private readonly timeoutMs = 5000) {
    this.origin = loopback(origin);
    Count.positive().parse(timeoutMs);
  }
  async connect(): Promise<void> {
    const response = await this.request("/test/capabilities");
    if (response.status !== 200) throw new ProtocolError("ADAPTER_CAPABILITIES_HTTP");
    TestCapabilities.parse(await response.json());
  }
  async event(event: z.infer<typeof TestEvent>): Promise<Reply> {
    return this.post("/test/events", TestEvent.parse(event));
  }
  async approval(command: z.infer<typeof TestApprovalCommand>, sessionRef: string): Promise<Reply> {
    return this.post("/test/approvals", TestApprovalCommand.parse(command), Id.parse(sessionRef));
  }
  async restart(): Promise<void> {
    this.origin = loopback(await this.lifecycle.restart());
    await this.connect();
  }
  async observe(): Promise<z.infer<typeof Observation>> {
    const response = await this.request("/test/observation");
    if (response.status !== 200) throw new ProtocolError("ADAPTER_OBSERVATION_HTTP");
    return Observation.parse(await response.json());
  }
  private async request(path: string, options: RequestInit = {}) {
    try {
      return await fetch(new URL(path, this.origin), {
        ...options, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      if (error instanceof TypeError || error instanceof DOMException) throw new ProtocolError("ADAPTER_TRANSPORT_FAILURE");
      throw error;
    }
  }
  private async post(path: string, body: unknown, sessionRef?: string): Promise<Reply> {
    const response = await this.request(path, {
      method: "POST", headers: {
        "content-type": "application/json",
        ...(sessionRef ? { "x-synthetic-session": sessionRef } : {})
      }, body: JSON.stringify(body)
    });
    return { httpStatus: response.status, acknowledgement: TestAcknowledgement.parse(await response.json()) };
  }
}

export async function runOfflineEpisode(input: unknown, adapter: ApplicationTestAdapter, simulator: Simulator) {
  const script = EpisodeScript.parse(input);
  if (adapter.kind !== "offline-test-double") throw new Error("CANDIDATE_EXECUTION_DISABLED");
  simulator.reset(script.dataset);
  let stepsCompleted = 0;
  try {
    await adapter.connect();
    for (const step of script.steps) {
      if (step.kind === "restart") await adapter.restart();
      else if (step.kind === "advance-clock") simulator.advanceTo(step.at);
      else {
        const message = step.kind === "event" ? step.event : step.command;
        const reply = step.kind === "event" ? await adapter.event(step.event) :
          await adapter.approval(step.command, step.sessionRef);
        if (reply.httpStatus !== step.expected.httpStatus || reply.acknowledgement.status !== step.expected.status ||
            reply.acknowledgement.id !== message.id) throw new ProtocolError("STEP_REPLY_MISMATCH");
      }
      stepsCompleted++;
    }
    const observation = await adapter.observe();
    const evaluation = evaluate(simulator.snapshot(), observation, script.oracle);
    return {
      kind: "offline-protocol-test" as const,
      benchmarkStatus: "not-run" as const,
      status: evaluation.status === "passed" && script.additionalAssertions.length ? "partial" : evaluation.status,
      stepsCompleted, scriptDigest: digest(script),
      primitiveEvaluation: evaluation,
      unsupportedAssertions: script.additionalAssertions.length,
      coverage: "protocol-and-primitive-oracle-only" as const
    };
  } catch (error) {
    const errorCode = error instanceof ProtocolError ? error.message :
      error instanceof z.ZodError ? "ADAPTER_SCHEMA_INVALID" :
      error instanceof SyntaxError ? "ADAPTER_JSON_INVALID" : null;
    if (!errorCode) throw error;
    // Never serialize exception messages: they can contain private fixture values or response bodies.
    return {
      kind: "offline-protocol-test" as const, benchmarkStatus: "not-run" as const,
      status: "failed" as const, stepsCompleted, scriptDigest: digest(script),
      primitiveEvaluation: null, unsupportedAssertions: script.additionalAssertions.length,
      errorCode
    };
  }
}
