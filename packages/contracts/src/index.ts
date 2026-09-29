import { z } from "zod";

export const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
export const Timestamp = z.iso.datetime();
export const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const Money = z.strictObject({
  minorUnits: Count,
  currency: z.string().regex(/^[A-Z]{3}$/)
});
export const CaseStatus = z.enum([
  "running", "awaiting_approval", "completed", "escalated", "rejected", "failed"
]);
export const ApprovalStatus = z.enum([
  "pending", "approved", "rejected", "cancelled", "expired", "invalidated"
]);
export const Role = z.enum(["operations_agent", "operations_approver", "supply_manager"]);
export const IdentityClaims = z.strictObject({
  actorId: Id,
  tenantId: Id,
  roles: z.array(Role).min(1),
  sessionId: Id
});
export const Evidence = z.strictObject({
  id: Id,
  tenantId: Id,
  source: z.enum(["direct", "third_party"]),
  sourceRef: Id,
  version: Id,
  observedAt: Timestamp,
  statement: z.string().min(1).max(4000)
});
export const Hotel = z.strictObject({
  id: Id,
  tenantId: Id,
  name: z.string().min(1),
  class: z.string().min(1),
  roomCategory: z.string().min(1),
  occupancy: Count.positive(),
  distanceMetres: Count,
  address: z.string().min(1),
  capacity: z.enum(["available", "unavailable", "unknown"]),
  evidenceIds: z.array(Id).min(1)
});
export const Arrival = z.strictObject({
  id: Id, tenantId: Id, hotelId: Id, arrivalAt: Timestamp,
  reconfirmation: z.enum(["confirmed", "missing", "failed"]),
  evidenceIds: z.array(Id)
});
export const HotelContract = z.strictObject({
  id: Id, tenantId: Id, hotelId: Id, version: Id,
  validFrom: Timestamp, validUntil: Timestamp,
  cancellationTerms: z.string().min(1),
  compensationTerms: z.string().min(1),
  evidenceIds: z.array(Id).min(1)
}).refine((v) => Date.parse(v.validFrom) < Date.parse(v.validUntil), "Invalid validity interval");
export const SupplierEvent = z.strictObject({
  id: Id, tenantId: Id, supplierId: Id, hotelId: Id,
  occurredAt: Timestamp, kind: z.enum(["cancelled", "missing_reconfirmation", "complaint"]),
  evidenceIds: z.array(Id).min(1)
});
export const Experience = z.strictObject({
  id: Id, tenantId: Id, opensAt: Timestamp, closesAt: Timestamp,
  capacity: z.enum(["available", "unavailable", "unknown"]),
  cancellationTerms: z.string().min(1), evidenceIds: z.array(Id).min(1)
}).refine((v) => Date.parse(v.opensAt) < Date.parse(v.closesAt), "Invalid opening interval");
export const Action = z.enum([
  "replacement_confirmation", "additional_spend", "supplier_commitment",
  "source_change", "markup_change", "supplier_message"
]);
export const ApprovalBinding = z.strictObject({
  actorId: Id, tenantId: Id, action: Action, caseId: Id,
  planVersion: Id, policyVersion: Id, proposedCost: Money,
  factsDigest: z.string().regex(/^[a-f0-9]{64}$/)
});
export const ApprovalRecord = z.strictObject({
  id: Id, binding: ApprovalBinding, status: ApprovalStatus,
  expiresAt: Timestamp, manualVerificationEventId: Id.nullable()
});
export const Handoff = z.strictObject({
  tenantId: Id, caseId: Id, approvalId: Id, effectId: Id,
  hotelId: Id, address: z.string().min(1), arrivalAt: Timestamp,
  planVersion: Id, evidenceIds: z.array(Id).min(1)
});
export const AuditEvent = z.strictObject({
  id: Id, tenantId: Id, caseId: Id, actorId: Id, at: Timestamp,
  action: Id, previousVersion: Id.nullable(), nextVersion: Id,
  evidenceIds: z.array(Id)
});
export const Resource = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("evidence"), data: Evidence }),
  z.strictObject({ kind: z.literal("hotel"), data: Hotel }),
  z.strictObject({ kind: z.literal("arrival"), data: Arrival }),
  z.strictObject({ kind: z.literal("contract"), data: HotelContract }),
  z.strictObject({ kind: z.literal("supplier_event"), data: SupplierEvent }),
  z.strictObject({ kind: z.literal("experience"), data: Experience })
]);
export const EffectRequest = z.strictObject({
  tenantId: Id, caseId: Id, actorId: Id, action: Action,
  idempotencyKey: Id, targetId: Id,
  planVersion: Id, policyVersion: Id, cost: Money,
  approvalId: Id.nullable(), evidenceIds: z.array(Id)
});
export const SeedStatus = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("neutral-seed"),
  benchmarkStatus: z.literal("not-run"),
  inference: z.literal("disabled"),
  businessImplementation: z.literal(false),
  storage: z.literal("sqlite"),
  bootCount: Count.positive()
});
export type Resource = z.infer<typeof Resource>;
export type EffectRequest = z.infer<typeof EffectRequest>;
export type SeedStatus = z.infer<typeof SeedStatus>;
