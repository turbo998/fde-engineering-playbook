import { z } from "zod";
import { Count, EffectRequest, Id, Resource, Timestamp } from "../../contracts/src/index.js";
import { canonicalJson } from "./encoding.js";

export const Fixture = z.strictObject({ revision: Id, resource: Resource });
export const Fault = z.strictObject({
  operation: z.enum(["read", "effect"]),
  call: Count.positive(),
  code: z.enum(["retrieval_failure", "inventory_failure", "service_unavailable"])
});
export const Dataset = z.strictObject({
  clock: Timestamp, policyVersion: Id,
  fixtures: z.array(Fixture), faults: z.array(Fault)
}).superRefine((value, ctx) => {
  const keys = value.fixtures.map((v) =>
    canonicalJson([v.resource.data.tenantId, v.resource.kind, v.resource.data.id, v.revision]));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Duplicate fixture key" });
  const faults = value.faults.map((v) => `${v.operation}:${v.call}`);
  if (new Set(faults).size !== faults.length) ctx.addIssue({ code: "custom", message: "Duplicate fault slot" });
});
export const Effect = z.strictObject({
  id: Id, at: Timestamp, request: EffectRequest, delivered: z.literal(false),
  causalSequence: Count.positive().nullable().default(null)
});
export const Attempt = z.strictObject({
  sequence: Count.positive(), at: Timestamp, request: EffectRequest,
  outcome: z.enum(["accepted", "duplicate", "conflict", "fault"]),
  effectId: Id.nullable(), faultCode: Fault.shape.code.nullable(),
  causalSequence: Count.positive().nullable().default(null)
});
export const TrustedControlEvent = z.strictObject({
  sequence: Count.positive(), at: Timestamp, kind: z.enum(["decision", "manual"]),
  trustedSequence: Count.positive(), eventDigest: z.string().regex(/^[a-f0-9]{64}$/)
});
export const TrustedControlInput = TrustedControlEvent.omit({ sequence: true, at: true });
export const CausalEvent = z.discriminatedUnion("kind", [
  TrustedControlEvent,
  z.strictObject({
    sequence: Count.positive(), at: Timestamp, kind: z.literal("effect-attempt"),
    attemptSequence: Count.positive(), requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: Attempt.shape.outcome, effectId: Id.nullable()
  })
]);
export const ReadAttempt = z.strictObject({
  sequence: Count.positive(), at: Timestamp, tenantId: Id,
  kind: z.enum(Resource.options.map((option) => option.shape.kind.value)),
  outcome: z.enum(["ok", "fault"]), faultCode: Fault.shape.code.nullable()
});
export const Snapshot = z.strictObject({
  kind: z.literal("synthetic-service-ledger"),
  clock: Timestamp, policyVersion: Id,
  attempts: z.array(Attempt), effects: z.array(Effect),
  reads: Count,
  readAttempts: z.array(ReadAttempt).nullable().default(null),
  causalEvents: z.array(CausalEvent).nullable().default(null)
});
