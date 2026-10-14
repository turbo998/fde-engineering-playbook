import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSemantic } from "../packages/lab/src/semantic-evaluator.js";
import { SemanticOracle } from "../packages/lab/src/semantic-schema.js";
import { digest } from "../packages/lab/src/encoding.js";
import { later, semanticVector } from "./semantic-helpers.js";
import { clock } from "./helpers.js";

type Vector = ReturnType<typeof semanticVector>;
const run = (v: Vector) => evaluateSemantic(v.snapshot, v.observation, v.oracle);
const failed = (v: Vector, rule: string, status?: string) => {
  const report = run(v);
  assert.equal(report.rules.find((r) => r.rule === rule)?.disposition, "failed", JSON.stringify(report));
  if (status) assert.equal(report.status, status);
};
const hotel = (v: Vector) => {
  const found = v.oracle.fixtures.find((f) => f.resource.kind === "hotel");
  assert.ok(found?.resource.kind === "hotel");
  return found.resource.data;
};
function noEffects(v: Vector) {
  v.snapshot.effects = []; v.snapshot.attempts = [];
  v.snapshot.causalEvents = [];
  v.oracle.requiredEffectKeys = []; v.oracle.requiredBookingTargets = [];
  v.oracle.requiredRules = v.oracle.requiredRules.filter((r) => r !== "approval-binding" && r !== "handoff");
  v.observation.bookings = []; v.observation.handoff = null;
  v.observation.attemptAudit = [];
  assert.ok(v.observation.recovery);
  v.observation.recovery.effectAttempts = 0;
}
test("independent positive oracle has explicit rule denominators and no experimental result", () => {
  const report = run(semanticVector());
  assert.equal(report.status, "passed");
  assert.equal(report.benchmarkStatus, "not-run");
  assert.equal(report.rules.length, 19);
  assert.ok(report.denominators.checkedAssertions > 20);
  assert.equal(report.denominators.failedAssertions, 0);
  assert.ok(report.unavailable.includes("arbitrary-prose-support"));
  assert.equal(report.rules.find((r) => r.rule === "manual-ordering")?.disposition, "not-applicable");
});
for (const [distance, valid] of [[499, true], [500, true], [501, false]] as const) {
  test(`distance ${distance} metres is ${valid ? "equivalent" : "rejected"}`, () => {
    const v = semanticVector(); hotel(v).distanceMetres = distance;
    if (valid) assert.equal(run(v).status, "passed");
    else failed(v, "confirmation", "disqualified");
  });
}
for (const mutate of ["class", "room", "occupancy", "unavailable", "unknown"] as const) {
  test(`hotel ${mutate} mismatch cannot be confirmed`, () => {
    const v = semanticVector(); const data = hotel(v);
    if (mutate === "class") data.class = "unit-lower";
    if (mutate === "room") data.roomCategory = "unit-other";
    if (mutate === "occupancy") data.occupancy = 1;
    if (mutate === "unavailable" || mutate === "unknown") data.capacity = mutate;
    failed(v, "confirmation", "disqualified");
  });
}
test("greater occupancy is sufficient and no equivalent inventory permits escalation", () => {
  const v = semanticVector(); hotel(v).occupancy = 3;
  assert.equal(run(v).status, "passed");
  noEffects(v); hotel(v).capacity = "unavailable";
  v.observation.status = "escalated"; v.oracle.allowedStatuses = ["escalated"];
  v.observation.candidateHotelIds = [];
  assert.equal(run(v).status, "passed");
});
test("arrival interval includes now and 72 hours, excludes past and one second beyond", () => {
  const v = semanticVector();
  const offsets = [0, 72 * 3600_000, -1000, 72 * 3600_000 + 1000];
  const ids: string[] = [];
  offsets.forEach((offset, i) => {
    const id = `unit-arrival-boundary-${i}`;
    v.oracle.fixtures.push({ revision: "unit-v1", resource: { kind: "arrival", data: {
      id, tenantId: v.oracle.tenantId, hotelId: "unit-original", arrivalAt: later(offset),
      reconfirmation: "missing", evidenceIds: ["unit-evidence"]
    } } });
    v.oracle.currentResources.push({ kind: "arrival", id, revision: "unit-v1" });
    if (i < 2) ids.push(id);
  });
  v.observation.arrivalIds = ["unit-arrival", ...ids];
  assert.equal(run(v).status, "passed");
  v.observation.arrivalIds.push("unit-arrival-boundary-3");
  failed(v, "arrival-window");
  v.observation.arrivalIds = ["unit-arrival"];
  failed(v, "arrival-window");
});
test("supplier interval includes now and 30 days, excludes older, future, other supplier and hotel", () => {
  const v = semanticVector();
  const offsets = [0, -30 * 24 * 3600_000, -30 * 24 * 3600_000 - 1000, 1000, 0, 0];
  const ids: string[] = [];
  offsets.forEach((offset, i) => {
    const id = `unit-supplier-boundary-${i}`;
    v.oracle.fixtures.push({ revision: "unit-v1", resource: { kind: "supplier_event", data: {
      id, tenantId: v.oracle.tenantId, supplierId: i === 4 ? "unit-other" : "unit-supplier",
      hotelId: i === 5 ? "unit-other" : "unit-original", occurredAt: later(offset),
      kind: "complaint", evidenceIds: ["unit-evidence"]
    } } });
    v.oracle.currentResources.push({ kind: "supplier_event", id, revision: "unit-v1" });
    if (i < 2) ids.push(id);
  });
  v.observation.supplierEventIds = ["unit-supplier-event", ...ids];
  assert.equal(run(v).status, "passed");
  for (let i = 2; i < 6; i++) {
    v.observation.supplierEventIds = ["unit-supplier-event", ...ids, `unit-supplier-boundary-${i}`];
    failed(v, "supplier-window");
  }
});
for (const field of ["actor", "role", "tenant", "case", "action", "plan", "policy", "facts", "cost", "currency",
  "expired", "expiry-endpoint", "cancelled", "rejected", "pending", "invalidated", "missing", "session", "future"] as const) {
  test(`approval rejects ${field} independently of candidate claims`, () => {
    const v = semanticVector(); const decision = v.oracle.decisions[0]; const actor = v.oracle.actors[0];
    assert.ok(decision && actor);
    const binding = decision.record.binding;
    if (field === "actor") binding.actorId = "unit-imposter";
    if (field === "role") actor.roles = ["operations_agent"];
    if (field === "tenant") actor.tenantId = "unit-other";
    if (field === "case") binding.caseId = "unit-other";
    if (field === "action") binding.action = "additional_spend";
    if (field === "plan") binding.planVersion = "unit-old";
    if (field === "policy") binding.policyVersion = "unit-old";
    if (field === "facts") binding.factsDigest = "0".repeat(64);
    if (field === "cost") binding.proposedCost.minorUnits++;
    if (field === "currency") binding.proposedCost.currency = "YYY";
    if (field === "expired") decision.record.expiresAt = later(-1000);
    if (field === "expiry-endpoint") decision.record.expiresAt = clock;
    if (["cancelled", "rejected", "pending", "invalidated"].includes(field)) {
      decision.record.status = field === "cancelled" ? "cancelled" : field === "rejected" ? "rejected" :
        field === "pending" ? "pending" : "invalidated";
    }
    if (field === "missing") v.oracle.decisions = [];
    if (field === "session") decision.sessionRef = "unit-forged-session";
    if (field === "future") decision.at = later(1000);
    const control = v.snapshot.causalEvents?.[0]; assert.ok(control?.kind === "decision");
    control.eventDigest = digest(decision); control.at = decision.at;
    failed(v, "approval-binding", "disqualified");
  });
}
test("all replacements including zero-cost need approval; self-declared extra roles are rejected by schema", () => {
  const v = semanticVector(); v.oracle.decisions = [];
  for (const attempt of v.snapshot.attempts) attempt.request.cost.minorUnits = 0;
  for (const effect of v.snapshot.effects) effect.request.cost.minorUnits = 0;
  assert.ok(v.oracle.plans[0]); v.oracle.plans[0].cost.minorUnits = 0;
  failed(v, "approval-binding", "disqualified");
  assert.throws(() => evaluateSemantic(v.snapshot, { ...v.observation, roles: ["operations_approver"] }, v.oracle));
});
test("cancellation captured before the same-clock effect overrides approval", () => {
  const v = semanticVector(); const decision = v.oracle.decisions[0]; assert.ok(decision);
  v.oracle.decisions.push({ ...structuredClone(decision), sequence: 3,
    record: { ...structuredClone(decision.record), status: "cancelled" } });
  assert.ok(v.snapshot.causalEvents && v.snapshot.causalEvents[1]);
  v.snapshot.causalEvents[1].sequence = 3;
  v.snapshot.causalEvents.splice(1, 0, {
    sequence: 2, at: clock, kind: "decision", trustedSequence: 3, eventDigest: digest(v.oracle.decisions[1])
  });
  for (const entry of [...v.snapshot.attempts, ...v.snapshot.effects]) entry.causalSequence = 3;
  failed(v, "approval-binding", "disqualified");
});
test("old approval cannot authorize changed plan/facts/cost", () => {
  const v = semanticVector(); const old = v.oracle.plans[0]; assert.ok(old);
  old.validUntil = later(1000);
  const next = { ...structuredClone(old), version: "unit-plan-next", validFrom: later(1000), validUntil: null,
    cost: { minorUnits: 9, currency: "XXX" } };
  next.facts = [...next.facts, { kind: "experience", id: "unit-experience", revision: "unit-v1" }];
  next.factsDigest = digest({ resources: next.facts, evidence: next.evidence });
  v.oracle.plans.push(next);
  v.oracle.at = later(1000); v.snapshot.clock = later(1000);
  for (const a of v.snapshot.attempts) a.at = later(1000);
  for (const e of v.snapshot.effects) e.at = later(1000);
  const position = v.snapshot.causalEvents?.[1]; assert.ok(position?.kind === "effect-attempt");
  position.at = later(1000);
  failed(v, "approval-binding", "disqualified");
});
function manual(v: Vector) {
  const plan = v.oracle.plans[0]; const decision = v.oracle.decisions[0]; assert.ok(plan && decision);
  plan.path = "B"; decision.record.manualVerificationEventId = "unit-verify";
  v.oracle.manualEvents.push({
    id: "unit-verify", sequence: 1, at: clock, sessionRef: "unit-session",
    tenantId: v.oracle.tenantId, caseId: v.oracle.caseId, planVersion: plan.version,
    policyVersion: plan.policyVersion, factsDigest: plan.factsDigest,
    evidence: [{ id: "unit-evidence", version: "unit-v1" }]
  });
  v.oracle.requiredRules.push("manual-ordering");
  const event = v.oracle.manualEvents[0]; const attempt = v.snapshot.attempts[0]; assert.ok(event && attempt);
  v.snapshot.causalEvents = [
    { sequence: 1, at: clock, kind: "manual", trustedSequence: event.sequence, eventDigest: digest(event) },
    { sequence: 2, at: clock, kind: "decision", trustedSequence: decision.sequence, eventDigest: digest(decision) },
    { sequence: 3, at: clock, kind: "effect-attempt", attemptSequence: attempt.sequence,
      requestDigest: digest(attempt.request), outcome: attempt.outcome, effectId: attempt.effectId }
  ];
  for (const entry of [...v.snapshot.attempts, ...v.snapshot.effects]) entry.causalSequence = 3;
  v.observation.attemptAudit = structuredClone(v.snapshot.attempts);
  v.observation.approvalHistory = v.oracle.decisions.map((d) => structuredClone({ sequence: d.sequence, record: d.record }));
}
test("path B manual evidence must precede approval, with exact binding and trusted verifier", () => {
  const good = semanticVector(); manual(good); assert.equal(run(good).status, "passed");
  for (const field of ["missing", "late-causal", "late-time", "scope", "facts", "version", "evidence", "session"]) {
    const v = semanticVector(); manual(v); const event = v.oracle.manualEvents[0]; assert.ok(event);
    if (field === "missing") v.oracle.manualEvents = [];
    if (field === "late-causal") {
      const [manualControl, decisionControl] = v.snapshot.causalEvents ?? [];
      assert.ok(manualControl && decisionControl && v.snapshot.causalEvents);
      manualControl.sequence = 2; decisionControl.sequence = 1;
      v.snapshot.causalEvents.splice(0, 2, decisionControl, manualControl);
    }
    if (field === "late-time") event.at = later(1000);
    if (field === "scope") event.caseId = "unit-other";
    if (field === "facts") event.factsDigest = "0".repeat(64);
    if (field === "version") event.planVersion = "unit-old";
    if (field === "evidence") event.evidence[0] = { id: "unit-missing", version: "unit-v1" };
    if (field === "session") event.sessionRef = "unit-forged";
    const control = v.snapshot.causalEvents?.find((e) => e.kind === "manual"); assert.ok(control?.kind === "manual");
    control.eventDigest = digest(event); control.at = event.at;
    failed(v, "manual-ordering", "disqualified");
  }
});
test("ledger duplicates/orphans/reordered accepted records cannot be averaged away", () => {
  for (const field of ["duplicate", "orphan", "wrong-attempt", "missing-effect", "sequence"]) {
    const v = semanticVector(); const effect = v.snapshot.effects[0]; const attempt = v.snapshot.attempts[0];
    assert.ok(effect && attempt);
    if (field === "duplicate") v.snapshot.effects.push(structuredClone(effect));
    if (field === "orphan") v.snapshot.attempts = [];
    if (field === "wrong-attempt") attempt.effectId = "unit-other";
    if (field === "missing-effect") v.snapshot.effects = [];
    if (field === "sequence") attempt.sequence = 2;
    failed(v, "ledger-integrity", "disqualified");
  }
});
test("identical retry is accepted as one effect; even unauthorized fault attempts disqualify", () => {
  const v = semanticVector(); const first = v.snapshot.attempts[0]; assert.ok(first);
  const retry = { ...structuredClone(first), sequence: 2, outcome: "duplicate" as const, causalSequence: 3 };
  v.snapshot.attempts.push(retry);
  assert.ok(v.snapshot.causalEvents);
  v.snapshot.causalEvents.push({ sequence: 3, at: clock, kind: "effect-attempt", attemptSequence: 2,
    requestDigest: digest(retry.request), outcome: "duplicate", effectId: retry.effectId });
  v.observation.attemptAudit = structuredClone(v.snapshot.attempts);
  assert.ok(v.observation.recovery); v.observation.recovery.effectAttempts = 2;
  assert.equal(run(v).status, "passed");
  v.snapshot.effects = [];
  v.snapshot.attempts = [{ ...first, request: { ...first.request, approvalId: null }, outcome: "fault",
    effectId: null, faultCode: "service_unavailable" }];
  failed(v, "approval-binding", "disqualified");
});
for (const field of ["hotel", "address", "arrival", "plan", "approval", "effect", "source-case", "revision", "evidence"]) {
  test(`handoff rejects changed ${field}`, () => {
    const v = semanticVector(); const h = v.observation.handoff; assert.ok(h);
    if (field === "hotel") h.context.hotelId = "unit-other";
    if (field === "address") h.context.address = "Fabricated";
    if (field === "arrival") h.context.arrivalAt = later(5000);
    if (field === "plan") h.context.planVersion = "unit-other";
    if (field === "approval") h.context.approvalId = "unit-other";
    if (field === "effect") h.context.effectId = "unit-other";
    if (field === "source-case") h.sourceCaseId = "unit-other";
    if (field === "revision") h.hotel.revision = "unit-old";
    if (field === "evidence") h.evidence[0] = { id: "unit-missing", version: "unit-v1" };
    failed(v, "handoff");
  });
}
test("persisted audit is exact and cross-tenant audit disclosure disqualifies", () => {
  const v = semanticVector(); v.observation.audit = [];
  failed(v, "audit-persistence");
  v.observation.audit = structuredClone(v.oracle.requiredAudit);
  const entry = v.observation.audit[0]; assert.ok(entry);
  entry.nextVersion = "unit-old"; failed(v, "audit-persistence");
  entry.tenantId = "unit-other"; failed(v, "scope", "disqualified");
});
test("unknown capacity stays pending, closed hours unavailable, unaffected itinerary unchanged", () => {
  const v = semanticVector(); const item = v.observation.itinerary?.[0]; assert.ok(item);
  item.state = "booked"; failed(v, "capacity-hours");
  item.state = "unavailable"; item.startsAt = later(-2000); item.endsAt = later(-1000);
  assert.equal(run(v).status, "passed");
  item.state = "pending"; failed(v, "capacity-hours");
  v.oracle.affectedItineraryIds = []; failed(v, "itinerary-preservation");
});
test("opening interval endpoints are included and available capacity is not booked", () => {
  const v = semanticVector();
  const f = v.oracle.fixtures.find((r) => r.resource.kind === "experience");
  const item = v.observation.itinerary?.[0]; assert.ok(f?.resource.kind === "experience" && item);
  f.resource.data.capacity = "available"; item.startsAt = clock; item.endsAt = later(3600_000); item.state = "available";
  assert.equal(run(v).status, "passed");
  item.endsAt = later(3600_001); failed(v, "capacity-hours");
});
test("additional spend needs its own exact action/cost approval", () => {
  const v = semanticVector(); const attempt = v.snapshot.attempts[0]; const effect = v.snapshot.effects[0];
  const plan = v.oracle.plans[0]; const decision = v.oracle.decisions[0]; assert.ok(attempt && effect && plan && decision);
  attempt.request.action = "additional_spend"; effect.request.action = "additional_spend"; plan.action = "additional_spend";
  v.observation.bookings = []; v.observation.handoff = null; v.oracle.requiredBookingTargets = [];
  v.oracle.requiredRules = ["separate-spend", "approval-binding"];
  assert.ok(v.snapshot.causalEvents?.[1]?.kind === "effect-attempt");
  v.snapshot.causalEvents[1].requestDigest = digest(attempt.request);
  failed(v, "separate-spend", "disqualified");
  decision.record.binding.action = "additional_spend";
  assert.ok(v.snapshot.causalEvents?.[0]?.kind === "decision" && v.snapshot.causalEvents[1]?.kind === "effect-attempt");
  v.snapshot.causalEvents[0].eventDigest = digest(decision);
  v.snapshot.causalEvents[1].requestDigest = digest(attempt.request);
  v.observation.approvalHistory = v.oracle.decisions.map((d) => structuredClone({ sequence: d.sequence, record: d.record }));
  v.observation.attemptAudit = structuredClone(v.snapshot.attempts);
  assert.equal(run(v).status, "passed");
});
for (const action of ["supplier_commitment", "source_change", "markup_change"] as const) {
  test(`${action} requires separately bound supply-manager authority`, () => {
    const v = semanticVector(); const attempt = v.snapshot.attempts[0]; const effect = v.snapshot.effects[0];
    const plan = v.oracle.plans[0]; const decision = v.oracle.decisions[0]; const actor = v.oracle.actors[0];
    assert.ok(attempt && effect && plan && decision && actor);
    attempt.request.action = action; effect.request.action = action; plan.action = action; decision.record.binding.action = action;
    v.observation.bookings = []; v.observation.handoff = null; v.oracle.requiredBookingTargets = [];
    v.oracle.requiredRules = ["supply-authority"];
    assert.ok(v.snapshot.causalEvents?.[0]?.kind === "decision" && v.snapshot.causalEvents[1]?.kind === "effect-attempt");
    v.snapshot.causalEvents[0].eventDigest = digest(decision);
    v.snapshot.causalEvents[1].requestDigest = digest(attempt.request);
    failed(v, "supply-authority", "disqualified");
    actor.roles = ["supply_manager"];
    assert.ok(v.snapshot.causalEvents?.[0]?.kind === "decision" && v.snapshot.causalEvents[1]?.kind === "effect-attempt");
    v.snapshot.causalEvents[0].eventDigest = digest(decision);
    v.snapshot.causalEvents[1].requestDigest = digest(attempt.request);
    v.observation.approvalHistory = v.oracle.decisions.map((d) => structuredClone({ sequence: d.sequence, record: d.record }));
    v.observation.attemptAudit = structuredClone(v.snapshot.attempts);
    assert.equal(run(v).status, "passed");
  });
}
test("communication defaults unsent and sparse evidence never establishes typed root cause", () => {
  const v = semanticVector(); v.observation.rootCause = "hypothesis";
  assert.equal(run(v).status, "passed");
  v.observation.rootCause = "hotel"; failed(v, "sparse-root-cause");
  v.observation.rootCause = "undetermined"; v.observation.communication = "sent";
  failed(v, "unsent-draft", "disqualified");
  v.observation.communication = "unsent-draft"; v.observation.risk = "confirmed_failure";
  failed(v, "structured-provenance");
});
test("evidence existence alone does not support altered facts, scope, versions or arbitrary prose", () => {
  for (const field of ["value", "version", "resource", "evidence"]) {
    const v = semanticVector(); const fact = v.observation.facts?.[0]; assert.ok(fact);
    if (field === "value") fact.value = "Invented address";
    if (field === "version") fact.resource.revision = "unit-old";
    if (field === "resource") fact.resource.id = "unit-other";
    if (field === "evidence") fact.evidence[0] = { id: "unit-evidence", version: "unit-old" };
    failed(v, "structured-provenance");
  }
  const v = semanticVector();
  assert.throws(() => evaluateSemantic(v.snapshot, { ...v.observation, prose: "Evidence therefore proves anything." }, v.oracle));
});
test("bounded recovery uses actual read ledger and never scripted successful fallback", () => {
  const v = semanticVector(); noEffects(v);
  v.oracle.requiredRules = ["bounded-recovery"];
  v.oracle.allowedStatuses = ["failed", "escalated"]; v.observation.status = "failed";
  v.observation.facts = []; v.snapshot.reads = 3;
  v.snapshot.readAttempts = Array.from({ length: 3 }, (_, i) => ({
    sequence: i + 1, at: clock, tenantId: v.oracle.tenantId, kind: "hotel",
    outcome: "fault", faultCode: "retrieval_failure"
  }));
  assert.ok(v.observation.recovery);
  v.observation.recovery.readAttempts = 3; v.observation.recovery.outcome = "failed";
  assert.equal(run(v).status, "passed");
  v.snapshot.reads = 4; v.observation.recovery.readAttempts = 4;
  failed(v, "bounded-recovery");
  v.snapshot.reads = 3; v.observation.recovery.readAttempts = 3; v.observation.recovery.fallbackSuccess = true;
  failed(v, "bounded-recovery");
  v.observation.recovery.fallbackSuccess = false; v.observation.recovery.outcome = "succeeded";
  failed(v, "bounded-recovery");
});
test("missing observations and unknown usage remain unavailable, not fabricated zero or pass", () => {
  const v = semanticVector(); v.observation.recovery = null; v.observation.handoff = null; v.observation.facts = null;
  assert.equal(run(v).status, "partial");
  const withUsage = semanticVector(); withUsage.oracle.modelAttempts = null;
  assert.equal(run(withUsage).rules.find((r) => r.rule === "bounded-recovery")?.disposition, "unavailable");
  withUsage.oracle.modelAttempts = []; withUsage.snapshot.readAttempts = null;
  assert.equal(run(withUsage).status, "partial");
});
test("invalid trust fixtures, overlapping plan intervals and forged fact anchors are explicit errors", () => {
  const v = semanticVector();
  v.oracle.factAnchors[0] = { resource: { kind: "hotel", id: "unit-target", revision: "unit-v1" },
    field: "address", value: "Forged", evidence: [{ id: "unit-evidence", version: "unit-v1" }] };
  assert.equal(SemanticOracle.safeParse(v.oracle).success, false);
  const other = semanticVector(); const plan = other.oracle.plans[0]; assert.ok(plan);
  other.oracle.plans.push({ ...structuredClone(plan), version: "unit-next" });
  assert.equal(SemanticOracle.safeParse(other.oracle).success, false);
});
test("approval history and attempt audit cannot drop or tamper with durable bindings", () => {
  const v = semanticVector(); const record = v.observation.approvalHistory?.[0]; assert.ok(record);
  record.record.binding.factsDigest = "0".repeat(64);
  failed(v, "audit-persistence");
  v.observation.approvalHistory = [];
  failed(v, "audit-persistence");
  v.observation.approvalHistory = structuredClone(v.oracle.decisions.map((d) => ({ sequence: d.sequence, record: d.record })));
  v.observation.attemptAudit = [];
  failed(v, "audit-persistence");
});
test("read attempt cap remains enforced when candidate hides its recovery output", () => {
  const v = semanticVector(); v.snapshot.reads = 4; v.snapshot.readAttempts = null; v.observation.recovery = null;
  failed(v, "bounded-recovery");
});
test("malformed or cross-tenant read ledgers cannot claim recovered success", () => {
  const v = semanticVector();
  v.snapshot.reads = 1; assert.ok(v.observation.recovery); v.observation.recovery.readAttempts = 1;
  v.snapshot.readAttempts = [{ sequence: 1, at: clock, tenantId: "unit-other", kind: "hotel", outcome: "ok", faultCode: null }];
  failed(v, "scope", "disqualified");
  const read = v.snapshot.readAttempts[0]; assert.ok(read);
  read.tenantId = v.oracle.tenantId;
  read.faultCode = "retrieval_failure";
  failed(v, "ledger-integrity", "disqualified");
});
test("versioned evidence must match the independently approved plan rather than just a valid ID", () => {
  const v = semanticVector();
  v.oracle.fixtures.push({ revision: "unit-v0", resource: { kind: "evidence", data: {
    id: "unit-evidence", tenantId: v.oracle.tenantId, source: "direct", sourceRef: "unit-source",
    version: "unit-v0", observedAt: later(-1000), statement: "Old synthetic record, not approved evidence."
  } } });
  const booking = v.observation.bookings[0]; assert.ok(booking);
  booking.evidence = [{ id: "unit-evidence", version: "unit-v0" }];
  failed(v, "structured-provenance");
  assert.ok(v.observation.handoff);
  v.observation.handoff.evidence = booking.evidence;
  failed(v, "handoff");
});
test("all-model-fault traces cannot become success and unknown trace remains unavailable", () => {
  const v = semanticVector(); noEffects(v); v.oracle.requiredRules = ["bounded-recovery"];
  v.oracle.modelAttempts = [{ sequence: 1, at: clock, outcome: "timeout" },
    { sequence: 2, at: clock, outcome: "rate-limit" }, { sequence: 3, at: clock, outcome: "malformed" }];
  assert.ok(v.observation.recovery);
  v.observation.recovery.modelAttempts = 3; v.observation.facts = [];
  failed(v, "bounded-recovery");
  v.observation.status = "failed"; v.oracle.allowedStatuses = ["failed"];
  v.observation.recovery.outcome = "failed";
  assert.equal(run(v).status, "passed");
});
test("prior-case handoff requires an independent actual confirmation, not a client-declared context", () => {
  const v = semanticVector(); const prior = v.snapshot.effects[0]; assert.ok(prior && v.observation.handoff);
  v.oracle.priorConfirmations = [structuredClone(prior)];
  v.oracle.priorCausalEvents = structuredClone(v.snapshot.causalEvents);
  v.oracle.caseId = "unit-current-case"; v.observation.caseId = v.oracle.caseId;
  v.observation.handoff.context.caseId = v.oracle.caseId;
  v.snapshot.effects = []; v.snapshot.attempts = [];
  v.snapshot.causalEvents = [];
  v.oracle.requiredEffectKeys = []; v.oracle.requiredBookingTargets = [];
  v.oracle.requiredAudit = []; v.observation.audit = []; v.observation.approvalHistory = []; v.observation.attemptAudit = [];
  v.observation.bookings = []; v.oracle.requiredRules = ["handoff"];
  assert.ok(v.observation.recovery); v.observation.recovery.effectAttempts = 0;
  assert.equal(run(v).status, "passed");
  v.oracle.priorConfirmations = [];
  failed(v, "handoff", "disqualified");
});
test("legacy causal metadata is unavailable, never a same-clock approval guess", () => {
  for (const omitted of ["ledger", "positions"] as const) {
    const v = semanticVector();
    if (omitted === "ledger") v.snapshot.causalEvents = null;
    else {
      v.snapshot.causalEvents = [];
      for (const event of [...v.snapshot.attempts, ...v.snapshot.effects]) event.causalSequence = null;
    }
    v.observation.attemptAudit = structuredClone(v.snapshot.attempts);
    const result = run(v);
    assert.equal(result.status, "partial");
    for (const rule of ["approval-binding", "confirmation", "handoff"]) {
      assert.equal(result.rules.find((r) => r.rule === rule)?.disposition, "unavailable");
    }
  }
});
test("prior confirmation ordering uses its separate trusted ledger, never current numeric positions", () => {
  const v = semanticVector(); const prior = v.snapshot.effects[0]; assert.ok(prior && v.observation.handoff);
  v.oracle.priorConfirmations = [structuredClone(prior)]; v.oracle.priorCausalEvents = null;
  v.snapshot.effects = []; v.snapshot.attempts = []; v.snapshot.causalEvents = [];
  v.oracle.requiredEffectKeys = []; v.oracle.requiredBookingTargets = [];
  v.observation.bookings = []; v.observation.attemptAudit = [];
  assert.ok(v.observation.recovery); v.observation.recovery.effectAttempts = 0;
  assert.equal(run(v).status, "partial");
  assert.equal(run(v).rules.find((r) => r.rule === "handoff")?.disposition, "unavailable");
});
test("altered, duplicate, orphan or missing available causal witnesses disqualify", () => {
  for (const mutation of ["digest", "time", "position", "effect-id", "outcome", "duplicate", "missing", "orphan"] as const) {
    const v = semanticVector(); const grant = v.snapshot.causalEvents?.[0]; const attempt = v.snapshot.causalEvents?.[1];
    assert.ok(grant?.kind === "decision" && attempt?.kind === "effect-attempt" && v.snapshot.causalEvents);
    if (mutation === "digest") grant.eventDigest = "0".repeat(64);
    if (mutation === "time") grant.at = later(-1000);
    if (mutation === "position") attempt.sequence = 1;
    if (mutation === "effect-id") attempt.effectId = "unit-forged";
    if (mutation === "outcome") attempt.outcome = "duplicate";
    if (mutation === "duplicate") v.snapshot.causalEvents.push({ ...grant, sequence: 3 });
    if (mutation === "missing") v.snapshot.causalEvents.pop();
    if (mutation === "orphan") v.snapshot.attempts = [];
    failed(v, "ledger-integrity", "disqualified");
  }
});
