import type { z } from "zod";
import { TestAcknowledgement, TestEvent } from "../../contracts/src/test-adapter.js";
import { digest } from "./encoding.js";
import { OfflineHttpAdapter, type ApplicationTestAdapter } from "./episode.js";
import { evaluateSemantic } from "./semantic-evaluator.js";
import { TypedSemanticEpisode } from "./semantic-episode-schema.js";
import { SemanticObservation } from "./semantic-schema.js";
import type { Simulator } from "./simulator.js";
export { SemanticAction, SemanticStep, TypedSemanticEpisode } from "./semantic-episode-schema.js";

export interface SemanticTestAdapter extends ApplicationTestAdapter {
  observeSemantic(): Promise<z.infer<typeof SemanticObservation>>;
}

export class OfflineSemanticHttpAdapter extends OfflineHttpAdapter implements SemanticTestAdapter {
  async observeSemantic(): Promise<z.infer<typeof SemanticObservation>> {
    const response = await this.request("/test/semantic-observation");
    if (response.status !== 200) throw new Error("SEMANTIC_OBSERVATION_HTTP");
    const parsed = SemanticObservation.safeParse(await response.json());
    if (!parsed.success) throw new Error("SEMANTIC_OBSERVATION_SCHEMA_INVALID");
    return parsed.data;
  }
}

export async function runOfflineSemanticEpisode(input: unknown, adapter: SemanticTestAdapter, simulator: Simulator) {
  const parsed = TypedSemanticEpisode.safeParse(input);
  if (!parsed.success) throw new Error("SEMANTIC_EPISODE_SCHEMA_INVALID");
  const script = parsed.data;
  if (adapter.kind !== "offline-test-double") throw new Error("CANDIDATE_EXECUTION_DISABLED");
  simulator.reset(script.dataset);
  await adapter.connect();
  let stepsCompleted = 0;
  for (const step of script.steps) {
    if (step.kind === "restart") await adapter.restart();
    else if (step.kind === "trusted-control") {
      const event = (step.eventKind === "decision" ? script.oracle.decisions : script.oracle.manualEvents)
        .find((e) => e.sequence === step.trustedSequence);
      if (!event) throw new Error("TRUSTED_CONTROL_REFERENCE_INVALID");
      const captured = simulator.recordTrustedControl({
        kind: step.eventKind, trustedSequence: step.trustedSequence, eventDigest: digest(event)
      });
      if (Date.parse(captured.at) !== Date.parse(event.at)) throw new Error("TRUSTED_CONTROL_CLOCK_MISMATCH");
    } else if (step.kind === "advance-clock") simulator.advanceTo(step.at);
    else if (step.kind === "observe") {
      if (digest(SemanticObservation.parse(await adapter.observeSemantic())) !== digest(step.expected)) {
        throw new Error("SEMANTIC_CHECKPOINT_MISMATCH");
      }
    } else {
      const message = step.kind === "approval" ? step.command : TestEvent.parse({
        id: step.id, tenantId: script.oracle.tenantId, caseId: script.oracle.caseId,
        type: step.action.kind, body: step.action
      });
      const reply = step.kind === "approval" ?
        await adapter.approval(step.command, step.sessionRef) : await adapter.event(TestEvent.parse(message));
      const acknowledgement = TestAcknowledgement.parse(reply.acknowledgement);
      if (reply.httpStatus !== step.expected.httpStatus || acknowledgement.status !== step.expected.status ||
          acknowledgement.id !== message.id) throw new Error("SEMANTIC_STEP_REPLY_MISMATCH");
    }
    stepsCompleted++;
  }
  return {
    kind: "offline-semantic-test" as const, benchmarkStatus: "not-run" as const,
    stepsCompleted, scriptDigest: digest(script),
    evaluation: evaluateSemantic(simulator.snapshot(), await adapter.observeSemantic(), script.oracle)
  };
}
