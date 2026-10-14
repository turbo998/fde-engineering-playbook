import { SemanticObservation, SemanticOracle, SemanticPlan, type ResourceRef } from "../packages/lab/src/semantic-schema.js";
import { Snapshot } from "../packages/lab/src/dataset.js";
import { digest } from "../packages/lab/src/encoding.js";
import { clock, request } from "./helpers.js";
import type { z } from "zod";

export const later = (milliseconds: number) => new Date(Date.parse(clock) + milliseconds).toISOString();
export function semanticVector() {
  const tenantId = request.tenantId;
  const ref = (kind: z.infer<typeof ResourceRef>["kind"], id: string) => ({ kind, id, revision: "unit-v1" });
  const evidence = [{ id: "unit-evidence", version: "unit-v1" }];
  const hotel = ref("hotel", "unit-target");
  const arrival = ref("arrival", "unit-arrival");
  const experience = ref("experience", "unit-experience");
  const facts = [hotel, arrival];
  const plan = SemanticPlan.parse({
    tenantId, caseId: request.caseId, version: request.planVersion, policyVersion: request.policyVersion,
    validFrom: clock, validUntil: null, action: request.action, targetId: request.targetId,
    cost: request.cost, facts, evidence, factsDigest: digest({ resources: facts, evidence }), path: "A", arrival
  });
  const effectRequest = { ...request, approvalId: "unit-approval" };
  const audit = {
    id: "unit-audit", tenantId, caseId: request.caseId, actorId: request.actorId, at: clock,
    action: "approved", previousVersion: null, nextVersion: request.planVersion,
    evidenceIds: request.evidenceIds
  };
  const item = {
    id: "unit-item", resource: experience, startsAt: later(1000), endsAt: later(2000), state: "pending" as const
  };
  const anchor = { resource: hotel, field: "address", value: "Unit synthetic address", evidence };
  const oracle = SemanticOracle.parse({
    schemaVersion: 1, kind: "independent-semantic-oracle", tenantId, caseId: request.caseId,
    at: clock, policyVersion: request.policyVersion,
    requiredRules: ["scope", "terminal-status", "arrival-window", "supplier-window", "hotel-equivalence",
      "approval-binding", "ledger-integrity", "audit-persistence", "confirmation", "handoff",
      "capacity-hours", "itinerary-preservation", "unsent-draft", "sparse-root-cause",
      "structured-provenance", "bounded-recovery"],
    allowedStatuses: ["completed"], policy: {
      arrivalWindowHours: 72, supplierLookbackDays: 30, maximumDistanceMetres: 500,
      requiredClass: "unit-grade", requiredRoomCategory: "unit-room", requiredOccupancy: 2
    },
    fixtures: [
      { revision: "unit-v1", resource: { kind: "evidence", data: {
        id: "unit-evidence", tenantId, source: "direct", sourceRef: "unit-source",
        version: "unit-v1", observedAt: clock, statement: "Generic synthetic test data, not prose verification."
      } } },
      { revision: "unit-v1", resource: { kind: "hotel", data: {
        id: "unit-target", tenantId, name: "Unit synthetic hotel", class: "unit-grade",
        roomCategory: "unit-room", occupancy: 2, distanceMetres: 499, address: "Unit synthetic address",
        capacity: "available", evidenceIds: ["unit-evidence"]
      } } },
      { revision: "unit-v1", resource: { kind: "hotel", data: {
        id: "unit-original", tenantId, name: "Unit original hotel", class: "unit-grade",
        roomCategory: "unit-room", occupancy: 2, distanceMetres: 0, address: "Unit original address",
        capacity: "unknown", evidenceIds: ["unit-evidence"]
      } } },
      { revision: "unit-v1", resource: { kind: "arrival", data: {
        id: "unit-arrival", tenantId, hotelId: "unit-original", arrivalAt: later(3600_000),
        reconfirmation: "missing", evidenceIds: ["unit-evidence"]
      } } },
      { revision: "unit-v1", resource: { kind: "supplier_event", data: {
        id: "unit-supplier-event", tenantId, supplierId: "unit-supplier", hotelId: "unit-original",
        occurredAt: clock, kind: "complaint", evidenceIds: ["unit-evidence"]
      } } },
      { revision: "unit-v1", resource: { kind: "experience", data: {
        id: "unit-experience", tenantId, opensAt: clock, closesAt: later(3600_000),
        capacity: "unknown", cancellationTerms: "Synthetic terms", evidenceIds: ["unit-evidence"]
      } } }
    ],
    currentResources: [ref("evidence", "unit-evidence"), hotel, ref("hotel", "unit-original"), arrival,
      ref("supplier_event", "unit-supplier-event"), experience],
    sourceRefs: ["unit-source"],
    actors: [{ actorId: request.actorId, tenantId, sessionId: "unit-session", roles: ["operations_approver"] }],
    plans: [plan], decisions: [{
      sequence: 2, at: clock, sessionRef: "unit-session",
      record: {
        id: "unit-approval", binding: {
          actorId: request.actorId, tenantId, action: request.action, caseId: request.caseId,
          planVersion: request.planVersion, policyVersion: request.policyVersion,
          proposedCost: request.cost, factsDigest: plan.factsDigest
        },
        status: "approved", expiresAt: later(3600_000), manualVerificationEventId: null
      }
    }],
    manualEvents: [], requiredAudit: [audit], supplierId: "unit-supplier", originalHotelId: "unit-original",
    risk: "risk", rootCause: "undetermined", factAnchors: [anchor],
    requiredEffectKeys: [request.idempotencyKey], requiredBookingTargets: [request.targetId],
    priorConfirmations: [], baselineItinerary: [item], affectedItineraryIds: [item.id],
    retryLimits: { reads: 3, effects: 3, models: 3 }, modelAttempts: []
  });
  const observation = SemanticObservation.parse({
    schemaVersion: 1, tenantId, caseId: request.caseId, status: "completed",
    arrivalIds: ["unit-arrival"], supplierEventIds: ["unit-supplier-event"], candidateHotelIds: ["unit-target"],
    risk: "risk", bookings: [{ targetId: request.targetId, effectId: "unit-effect", evidence }],
    handoff: {
      context: { tenantId, caseId: request.caseId, approvalId: "unit-approval", effectId: "unit-effect",
        hotelId: request.targetId, address: "Unit synthetic address", arrivalAt: later(3600_000),
        planVersion: request.planVersion, evidenceIds: ["unit-evidence"] },
      sourceCaseId: request.caseId, hotel, arrival, evidence
    },
    audit: [audit], approvalHistory: oracle.decisions.map((d) => ({ sequence: d.sequence, record: d.record })),
    attemptAudit: [], itinerary: [item], communication: "unsent-draft", rootCause: "undetermined", facts: [anchor],
    recovery: { readAttempts: 0, effectAttempts: 1, modelAttempts: 0, outcome: "succeeded", fallbackSuccess: false }
  });
  const snapshot = Snapshot.parse({
    kind: "synthetic-service-ledger", clock, policyVersion: request.policyVersion, reads: 0, readAttempts: [],
    attempts: [{ sequence: 1, at: clock, request: effectRequest, outcome: "accepted",
      effectId: "unit-effect", faultCode: null }],
    effects: [{ id: "unit-effect", at: clock, request: effectRequest, delivered: false }]
  });
  observation.attemptAudit = structuredClone(snapshot.attempts);
  return { oracle, observation, snapshot };
}
