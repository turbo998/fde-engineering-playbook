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
  id: Id, at: Timestamp, request: EffectRequest, delivered: z.literal(false)
});
export const Attempt = z.strictObject({
  sequence: Count.positive(), at: Timestamp, request: EffectRequest,
  outcome: z.enum(["accepted", "duplicate", "conflict", "fault"]),
  effectId: Id.nullable(), faultCode: Fault.shape.code.nullable()
});
export const Snapshot = z.strictObject({
  kind: z.literal("synthetic-service-ledger"),
  clock: Timestamp, policyVersion: Id,
  attempts: z.array(Attempt), effects: z.array(Effect),
  reads: Count
});
