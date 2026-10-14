import { z } from "zod";
import { EffectRequest, Id, Money, Timestamp } from "../../contracts/src/index.js";
import { TestAcknowledgement, TestApprovalCommand } from "../../contracts/src/test-adapter.js";
import { Dataset, Effect } from "./dataset.js";
import { digest } from "./encoding.js";
import { Hash, ResourceRef, SemanticObservation, SemanticOracle, SemanticPlan, SemanticRule, TrustedDecision } from "./semantic-schema.js";

export const SemanticAction = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("analyze-arrival"), arrival: ResourceRef }),
  z.strictObject({ kind: z.literal("propose-replacement"), path: z.enum(["A", "B"]) }),
  z.strictObject({ kind: z.literal("manual-verification"), eventId: Id, sessionRef: Id, plan: SemanticPlan }),
  z.strictObject({ kind: z.literal("revise-plan"), plan: SemanticPlan }),
  z.strictObject({ kind: z.literal("execute-effect"), request: EffectRequest }),
  z.strictObject({ kind: z.literal("reconfirmation"), arrival: ResourceRef, occurredAt: Timestamp, version: Id }),
  z.strictObject({
    kind: z.literal("adopt-confirmed-context"), effect: Effect, plan: SemanticPlan, approval: TrustedDecision
  }),
  z.strictObject({ kind: z.literal("request-experience"), resource: ResourceRef, startsAt: Timestamp, endsAt: Timestamp }),
  z.strictObject({ kind: z.literal("propose-spend"), targetId: Id, cost: Money }),
  z.strictObject({ kind: z.literal("analyze-supplier"), supplierId: Id }),
  z.strictObject({
    kind: z.literal("propose-supplier-action"),
    action: z.enum(["supplier_commitment", "source_change", "markup_change"]),
    targetId: Id, cost: Money
  }),
  z.strictObject({ kind: z.literal("draft-communication"), supplierId: Id })
]);
const ExpectedReply = z.strictObject({
  httpStatus: z.union([z.literal(200), z.literal(202), z.literal(400), z.literal(403), z.literal(409), z.literal(503)]),
  status: TestAcknowledgement.shape.status
});
export const SemanticStep = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("action"), id: Id, action: SemanticAction, expected: ExpectedReply }),
  z.strictObject({ kind: z.literal("approval"), command: TestApprovalCommand, sessionRef: Id, expected: ExpectedReply }),
  z.strictObject({ kind: z.literal("restart") }),
  z.strictObject({ kind: z.literal("advance-clock"), at: Timestamp }),
  z.strictObject({ kind: z.literal("observe"), expected: SemanticObservation })
]);
export const TypedSemanticEpisode = z.strictObject({
  schemaVersion: z.literal(2), kind: z.literal("private-typed-semantic-preparation"),
  executionStatus: z.literal("not-run"), id: Id, dataset: Dataset,
  steps: z.array(SemanticStep).min(1), oracle: SemanticOracle,
  sourceStepMappings: z.array(z.strictObject({
    sourceIndex: z.number().int().nonnegative(), sourceDigest: Hash,
    typedStepIndices: z.array(z.number().int().nonnegative()).min(1),
    rationale: z.string().min(1)
  })).min(1)
}).superRefine((script, ctx) => {
  const fail = () => ctx.addIssue({ code: "custom", message: "TYPED_EPISODE_MAPPING_INVALID" });
  if (script.sourceStepMappings.some((m, i) => m.sourceIndex !== i ||
      m.typedStepIndices.some((index) => index >= script.steps.length))) fail();
  if (script.steps.some((_s, i) => !script.sourceStepMappings.some((m) => m.typedStepIndices.includes(i)))) fail();
  const mapped = script.sourceStepMappings.flatMap((m) => m.typedStepIndices);
  if (new Set(mapped).size !== mapped.length) fail();
  if (script.dataset.policyVersion !== script.oracle.policyVersion) fail();
  if (script.steps.some((step) => step.kind === "approval" &&
      !script.oracle.actors.some((actor) => actor.sessionId === step.sessionRef))) fail();
});
export const AssertionClassification = z.strictObject({
  sourceIndex: z.number().int().nonnegative(), sourceDigest: Hash,
  category: z.enum(["implemented-machine-rule", "prepared-unexecuted-integration", "rubric-required", "unsupported"]),
  rules: z.array(SemanticRule),
  rationale: z.string().min(1),
  unavailableParts: z.array(z.string().min(1))
}).superRefine((assertion, ctx) => {
  if (assertion.category === "implemented-machine-rule" &&
      (!assertion.rules.length || assertion.unavailableParts.length)) {
    ctx.addIssue({ code: "custom", message: "ASSERTION_COVERAGE_OVERCLAIM" });
  }
  if (assertion.category !== "implemented-machine-rule" && !assertion.unavailableParts.length) {
    ctx.addIssue({ code: "custom", message: "ASSERTION_BOUNDARY_REQUIRED" });
  }
});
export const PrivateSemanticCompanion = z.strictObject({
  schemaVersion: z.literal(2), kind: z.literal("private-semantic-companion"),
  executionStatus: z.literal("not-run"), sourceSHA256: Hash,
  schemaDigest: Hash, implementationCommit: z.string().regex(/^[a-f0-9]{40}$/),
  cases: z.array(z.strictObject({
    script: TypedSemanticEpisode, scriptDigest: Hash,
    assertions: z.array(AssertionClassification)
  })).length(12)
}).superRefine((companion, ctx) => {
  if (new Set(companion.cases.map((c) => c.script.id)).size !== companion.cases.length ||
      companion.cases.some((c) => digest(c.script) !== c.scriptDigest ||
        c.assertions.some((a, i) => a.sourceIndex !== i))) {
    ctx.addIssue({ code: "custom", message: "COMPANION_DIGEST_OR_MAPPING_INVALID" });
  }
});
