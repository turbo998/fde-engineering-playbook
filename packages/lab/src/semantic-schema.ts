import { z } from "zod";
import {
  Action, ApprovalRecord, AuditEvent, CaseStatus, Count, Handoff, Id, IdentityClaims,
  Money, Resource, Timestamp
} from "../../contracts/src/index.js";
import { Attempt, Effect, Fixture } from "./dataset.js";
import { digest } from "./encoding.js";

export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ResourceRef = z.strictObject({
  kind: z.enum(Resource.options.map((option) => option.shape.kind.value)), id: Id, revision: Id
});
export const EvidenceRef = z.strictObject({ id: Id, version: Id });
export const SemanticRule = z.enum([
  "scope", "terminal-status", "arrival-window", "supplier-window", "hotel-equivalence",
  "approval-binding", "manual-ordering", "ledger-integrity", "audit-persistence",
  "confirmation", "handoff", "capacity-hours", "itinerary-preservation",
  "separate-spend", "supply-authority", "unsent-draft", "sparse-root-cause",
  "structured-provenance", "bounded-recovery"
]);
export type SemanticRule = z.infer<typeof SemanticRule>;
export const SemanticPlan = z.strictObject({
  tenantId: Id, caseId: Id, version: Id, policyVersion: Id,
  validFrom: Timestamp, validUntil: Timestamp.nullable(),
  action: Action, targetId: Id, cost: Money,
  facts: z.array(ResourceRef).min(1), evidence: z.array(EvidenceRef).min(1), factsDigest: Hash,
  path: z.enum(["A", "B"]), arrival: ResourceRef.nullable()
}).superRefine((plan, ctx) => {
  if (plan.factsDigest !== digest({ resources: plan.facts, evidence: plan.evidence }) ||
      (plan.validUntil !== null && Date.parse(plan.validUntil) <= Date.parse(plan.validFrom))) {
    ctx.addIssue({ code: "custom", message: "SEMANTIC_PLAN_INVALID" });
  }
});
export const TrustedManualEvent = z.strictObject({
  id: Id, sequence: Count.positive(), at: Timestamp, sessionRef: Id,
  tenantId: Id, caseId: Id, planVersion: Id, policyVersion: Id, factsDigest: Hash,
  evidence: z.array(EvidenceRef).min(1)
});
export const TrustedDecision = z.strictObject({
  sequence: Count.positive(), at: Timestamp, sessionRef: Id, record: ApprovalRecord
});
export const StructuredFact = z.strictObject({
  resource: ResourceRef,
  field: z.enum([
    "class", "roomCategory", "occupancy", "distanceMetres", "address", "capacity",
    "arrivalAt", "reconfirmation", "occurredAt", "kind", "opensAt", "closesAt",
    "cancellationTerms", "compensationTerms"
  ]),
  value: z.json(), evidence: z.array(EvidenceRef).min(1)
});
const ItineraryItem = z.strictObject({
  id: Id, resource: ResourceRef, startsAt: Timestamp, endsAt: Timestamp,
  state: z.enum(["pending", "available", "unavailable", "booked"])
}).refine((v) => Date.parse(v.startsAt) <= Date.parse(v.endsAt), "ITINERARY_INTERVAL_INVALID");
export const SemanticObservation = z.strictObject({
  schemaVersion: z.literal(1), tenantId: Id, caseId: Id, status: CaseStatus,
  arrivalIds: z.array(Id).nullable(), supplierEventIds: z.array(Id).nullable(),
  candidateHotelIds: z.array(Id).nullable(),
  risk: z.enum(["risk", "confirmed_failure", "none"]).nullable(),
  bookings: z.array(z.strictObject({
    targetId: Id, effectId: Id, evidence: z.array(EvidenceRef).min(1)
  })),
  handoff: z.strictObject({
    context: Handoff, sourceCaseId: Id, hotel: ResourceRef, arrival: ResourceRef,
    evidence: z.array(EvidenceRef).min(1)
  }).nullable(),
  audit: z.array(AuditEvent).nullable(),
  approvalHistory: z.array(z.strictObject({ sequence: Count.positive(), record: ApprovalRecord })).nullable(),
  attemptAudit: z.array(Attempt).nullable(),
  itinerary: z.array(ItineraryItem).nullable(),
  communication: z.enum(["unsent-draft", "sent", "none"]).nullable(),
  rootCause: z.enum(["undetermined", "hypothesis", "hotel", "channel"]).nullable(),
  facts: z.array(StructuredFact).nullable(),
  recovery: z.strictObject({
    readAttempts: Count, effectAttempts: Count, modelAttempts: Count.nullable(),
    outcome: z.enum(["succeeded", "failed", "escalated", "pending"]),
    fallbackSuccess: z.boolean()
  }).nullable()
});
export const SemanticOracle = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal("independent-semantic-oracle"),
  tenantId: Id, caseId: Id, at: Timestamp, policyVersion: Id,
  requiredRules: z.array(SemanticRule),
  allowedStatuses: z.array(CaseStatus).min(1),
  policy: z.strictObject({
    arrivalWindowHours: z.literal(72), supplierLookbackDays: z.literal(30),
    maximumDistanceMetres: z.literal(500), requiredClass: z.string().min(1),
    requiredRoomCategory: z.string().min(1), requiredOccupancy: Count.positive()
  }),
  fixtures: z.array(Fixture),
  currentResources: z.array(ResourceRef),
  sourceRefs: z.array(Id),
  actors: z.array(IdentityClaims),
  plans: z.array(SemanticPlan),
  decisions: z.array(TrustedDecision),
  manualEvents: z.array(TrustedManualEvent),
  requiredAudit: z.array(AuditEvent),
  supplierId: Id.nullable(), originalHotelId: Id.nullable(),
  risk: z.enum(["risk", "confirmed_failure", "none"]).nullable(),
  rootCause: z.enum(["undetermined", "hotel", "channel"]),
  factAnchors: z.array(StructuredFact),
  requiredEffectKeys: z.array(Id),
  requiredBookingTargets: z.array(Id),
  priorConfirmations: z.array(Effect),
  baselineItinerary: z.array(ItineraryItem), affectedItineraryIds: z.array(Id),
  retryLimits: z.strictObject({ reads: Count, effects: Count, models: Count }),
  modelAttempts: z.array(z.strictObject({
    sequence: Count.positive(), at: Timestamp,
    outcome: z.enum(["ok", "timeout", "rate-limit", "malformed"])
  })).nullable()
}).superRefine((oracle, ctx) => {
  const issue = () => ctx.addIssue({ code: "custom", message: "SEMANTIC_TRUST_INPUT_INVALID" });
  const unique = (keys: string[]) => { if (new Set(keys).size !== keys.length) issue(); };
  unique(oracle.requiredRules);
  unique(oracle.fixtures.map((f) => digest([f.resource.data.tenantId, f.resource.kind, f.resource.data.id, f.revision])));
  unique(oracle.currentResources.map((r) => digest([r.kind, r.id])));
  unique(oracle.actors.map((a) => a.sessionId));
  unique(oracle.actors.map((a) => digest([a.tenantId, a.actorId])));
  unique(oracle.plans.map((p) => digest([p.tenantId, p.caseId, p.version, p.action])));
  unique([...oracle.decisions.map((d) => String(d.sequence)), ...oracle.manualEvents.map((e) => String(e.sequence))]);
  unique(oracle.manualEvents.map((e) => e.id));
  unique(oracle.requiredAudit.map((e) => e.id));
  if (oracle.requiredAudit.some((e) => e.tenantId !== oracle.tenantId || e.caseId !== oracle.caseId)) issue();
  unique(oracle.factAnchors.map((a) => digest([a.resource, a.field])));
  unique(oracle.baselineItinerary.map((i) => i.id));
  unique(oracle.affectedItineraryIds);
  unique(oracle.requiredEffectKeys);
  unique(oracle.requiredBookingTargets);
  for (const ref of [...oracle.currentResources, ...oracle.plans.flatMap((p) => p.facts)]) {
    if (!resolveResource(oracle.fixtures, oracle.tenantId, ref)) issue();
  }
  for (const plan of oracle.plans) {
    if (plan.tenantId !== oracle.tenantId ||
        (plan.arrival !== null && (!plan.facts.some((r) => digest(r) === digest(plan.arrival)) ||
          plan.arrival.kind !== "arrival"))) issue();
    if (!plan.evidence.every((ref) => oracle.fixtures.some((f) =>
      f.resource.kind === "evidence" && f.resource.data.tenantId === plan.tenantId &&
      f.resource.data.id === ref.id && f.resource.data.version === ref.version &&
      Date.parse(f.resource.data.observedAt) <= Date.parse(plan.validFrom) &&
      oracle.sourceRefs.includes(f.resource.data.sourceRef)))) issue();
  }
  for (const ref of oracle.currentResources) {
    const resource = resolveResource(oracle.fixtures, oracle.tenantId, ref);
    if (resource?.kind === "evidence" && (Date.parse(resource.data.observedAt) > Date.parse(oracle.at) ||
        !oracle.sourceRefs.includes(resource.data.sourceRef))) issue();
  }
  for (const anchor of oracle.factAnchors) {
    const resource = resolveResource(oracle.fixtures, oracle.tenantId, anchor.resource);
    const linked = resource && "evidenceIds" in resource.data ? resource.data.evidenceIds : [];
    if (!resource || !(anchor.field in resource.data) ||
        digest(Reflect.get(resource.data, anchor.field)) !== digest(anchor.value) ||
        !("evidenceIds" in resource.data) ||
        !anchor.evidence.every((ref) => linked.includes(ref.id))) issue();
    if (!anchor.evidence.every((ref) => oracle.fixtures.some((f) =>
      f.resource.kind === "evidence" && f.resource.data.tenantId === oracle.tenantId &&
      f.resource.data.id === ref.id && f.resource.data.version === ref.version &&
      Date.parse(f.resource.data.observedAt) <= Date.parse(oracle.at) &&
      oracle.sourceRefs.includes(f.resource.data.sourceRef)))) issue();
  }
  if (oracle.affectedItineraryIds.some((id) => !oracle.baselineItinerary.some((i) => i.id === id))) issue();
  for (const plan of oracle.plans) {
    if (oracle.plans.some((other) => other !== plan && other.caseId === plan.caseId &&
        other.action === plan.action &&
        Date.parse(other.validFrom) < (plan.validUntil === null ? Infinity : Date.parse(plan.validUntil)) &&
        Date.parse(plan.validFrom) < (other.validUntil === null ? Infinity : Date.parse(other.validUntil)))) issue();
  }
});

export function resolveResource(fixtures: z.infer<typeof Fixture>[], tenantId: string, ref: z.infer<typeof ResourceRef>) {
  return fixtures.find((f) => f.resource.data.tenantId === tenantId &&
    f.resource.kind === ref.kind && f.resource.data.id === ref.id && f.revision === ref.revision)?.resource;
}
export type SemanticOracle = z.infer<typeof SemanticOracle>;
export type SemanticObservation = z.infer<typeof SemanticObservation>;
export type SemanticPlan = z.infer<typeof SemanticPlan>;
