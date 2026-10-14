import type { z } from "zod";
import type { EffectRequest } from "../../contracts/src/index.js";
import { Snapshot, type CausalEvent, type Effect } from "./dataset.js";
import { canonicalJson, digest } from "./encoding.js";
import {
  resolveResource, SemanticObservation, SemanticOracle, SemanticRule,
  type EvidenceRef
} from "./semantic-schema.js";

type Severity = "critical" | "major";
type RuleResult = {
  rule: SemanticRule; severity: Severity;
  disposition: "passed" | "failed" | "unavailable" | "not-applicable";
  checked: number; failed: number; unavailable: number; codes: string[];
};
const critical = new Set<SemanticRule>([
  "scope", "approval-binding", "manual-ordering", "ledger-integrity", "confirmation",
  "separate-spend", "supply-authority", "unsent-draft", "handoff"
]);

export function evaluateSemantic(snapshotInput: unknown, observationInput: unknown, oracleInput: unknown) {
  const snapshot = Snapshot.parse(snapshotInput);
  const observation = SemanticObservation.parse(observationInput);
  const oracle = SemanticOracle.parse(oracleInput);
  const results = new Map<SemanticRule, RuleResult>(SemanticRule.options.map((rule) => [rule, {
    rule, severity: critical.has(rule) ? "critical" : "major",
    disposition: "not-applicable", checked: 0, failed: 0, unavailable: 0, codes: []
  }]));
  const result = (rule: SemanticRule) => {
    const entry = results.get(rule);
    if (!entry) throw new Error("SEMANTIC_RULE_UNKNOWN");
    return entry;
  };
  const check = (rule: SemanticRule, ok: boolean, code: string) => {
    const entry = result(rule);
    entry.checked++;
    if (!ok) { entry.failed++; if (!entry.codes.includes(code)) entry.codes.push(code); }
  };
  const missing = (rule: SemanticRule, code: string) => {
    const entry = result(rule);
    entry.unavailable++;
    if (!entry.codes.includes(code)) entry.codes.push(code);
  };
  const judge = (rule: SemanticRule, verdict: boolean | null, code: string) => {
    if (verdict === null) missing(rule, "CAUSAL_AUTHORITY_UNAVAILABLE");
    else check(rule, verdict, code);
  };
  const required = (rule: SemanticRule) => oracle.requiredRules.includes(rule);
  const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  const sameSet = (a: string[], b: string[]) =>
    new Set(a).size === a.length && new Set(b).size === b.length && equal([...a].sort(), [...b].sort());
  const resource = (ref: Parameters<typeof resolveResource>[2]) => resolveResource(oracle.fixtures, oracle.tenantId, ref);
  const current = (kind: Parameters<typeof resolveResource>[2]["kind"], id: string) => {
    const ref = oracle.currentResources.find((r) => r.kind === kind && r.id === id);
    return ref ? resource(ref) : undefined;
  };
  const evidence = (refs: z.infer<typeof EvidenceRef>[], at = oracle.at) => refs.length > 0 && refs.every((ref) => {
    const item = oracle.fixtures.find((f) => f.resource.kind === "evidence" &&
      f.resource.data.tenantId === oracle.tenantId && f.resource.data.id === ref.id &&
      f.resource.data.version === ref.version)?.resource;
    return item?.kind === "evidence" && item.data.version === ref.version &&
      Date.parse(item.data.observedAt) <= Date.parse(at) && oracle.sourceRefs.includes(item.data.sourceRef);
  });
  const planFor = (request: EffectRequest, at: string) => oracle.plans.find((plan) =>
    plan.tenantId === request.tenantId && plan.caseId === request.caseId && plan.action === request.action &&
    Date.parse(plan.validFrom) <= Date.parse(at) &&
    (plan.validUntil === null || Date.parse(at) < Date.parse(plan.validUntil)));
  const roleFor = (action: EffectRequest["action"]) =>
    ["supplier_commitment", "source_change", "markup_change", "supplier_message"].includes(action) ?
      "supply_manager" as const : "operations_approver" as const;
  type Ledger = z.infer<typeof CausalEvent>[] | null;
  const controlFor = (event: { sequence: number; at: string }, kind: "decision" | "manual", ledger: Ledger) => {
    for (const entry of ledger ?? []) {
      if (entry.kind === kind && entry.trustedSequence === event.sequence &&
          entry.eventDigest === digest(event) && Date.parse(entry.at) === Date.parse(event.at)) return entry;
    }
    return undefined;
  };
  const decisionsAt = (approvalId: string, at: string, causalSequence: number, ledger: Ledger) =>
    oracle.decisions.flatMap((decision) => {
      const control = controlFor(decision, "decision", ledger);
      return control && decision.record.id === approvalId && control.sequence < causalSequence &&
        Date.parse(control.at) <= Date.parse(at) ? [{ decision, control }] : [];
    }).sort((a, b) => b.control.sequence - a.control.sequence)[0];
  const authorizes = (request: EffectRequest, at: string, report: boolean,
    causalSequence: number | null, ledger: Ledger): boolean | null => {
    const plan = planFor(request, at);
    if (causalSequence === null || ledger === null) {
      if (report) {
        missing("approval-binding", "CAUSAL_AUTHORITY_UNAVAILABLE");
        if (plan?.path === "B") missing("manual-ordering", "CAUSAL_AUTHORITY_UNAVAILABLE");
        if (request.action === "additional_spend") missing("separate-spend", "CAUSAL_AUTHORITY_UNAVAILABLE");
        if (roleFor(request.action) === "supply_manager") missing("supply-authority", "CAUSAL_AUTHORITY_UNAVAILABLE");
      }
      return null;
    }
    const position = ledger.find((e) => e.sequence === causalSequence);
    const positionValid = position?.kind === "effect-attempt" &&
      position.requestDigest === digest(request) && Date.parse(position.at) === Date.parse(at);
    if (report) check("ledger-integrity", positionValid, "EFFECT_CAUSAL_WITNESS_INVALID");
    const witnessed = request.approvalId === null ? undefined :
      decisionsAt(request.approvalId, at, causalSequence, ledger);
    const decision = witnessed?.decision;
    const actor = oracle.actors.find((a) => a.sessionId === decision?.sessionRef);
    const binding = decision?.record.binding;
    const scope = request.tenantId === oracle.tenantId && (request.caseId === oracle.caseId ||
      oracle.priorConfirmations.some((e) => equal(e.request, request)));
    const valid = positionValid && scope && !!plan && plan.version === request.planVersion &&
      plan.policyVersion === request.policyVersion && plan.policyVersion === oracle.policyVersion &&
      plan.targetId === request.targetId && equal(plan.cost, request.cost) &&
      (request.action !== "replacement_confirmation" || plan.facts.some((r) =>
        r.kind === "hotel" && r.id === request.targetId)) &&
      request.evidenceIds.length > 0 && request.evidenceIds.every((id) => plan.evidence.some((r) => r.id === id)) &&
      evidence(plan.evidence, at) &&
      !!decision && decision.record.status === "approved" &&
      Date.parse(at) < Date.parse(decision.record.expiresAt) &&
      !!actor && actor.actorId === request.actorId && actor.tenantId === request.tenantId &&
      actor.roles.includes(roleFor(request.action)) &&
      !!binding && equal(binding, {
        actorId: request.actorId, tenantId: request.tenantId, caseId: request.caseId,
        action: request.action, planVersion: request.planVersion, policyVersion: request.policyVersion,
        proposedCost: request.cost, factsDigest: plan.factsDigest
      });
    if (report) {
      check("approval-binding", valid, "UNAUTHORIZED_OR_STALE_BINDING");
      if (request.action === "additional_spend") check("separate-spend", valid, "SEPARATE_APPROVAL_REQUIRED");
      if (roleFor(request.action) === "supply_manager") check("supply-authority", valid, "SUPPLY_ROLE_REQUIRED");
    }
    if (report) check("structured-provenance", !!plan && evidence(plan.evidence, at) &&
      request.evidenceIds.length > 0 && request.evidenceIds.every((id) => plan.evidence.some((r) => r.id === id)),
      "EFFECT_EVIDENCE_INVALID");
    let manual = true;
    if (plan?.path === "B") {
      const event = oracle.manualEvents.find((e) => e.id === decision?.record.manualVerificationEventId);
      const manualControl = event ? controlFor(event, "manual", ledger) : undefined;
      const verifier = oracle.actors.find((a) => a.sessionId === event?.sessionRef);
      manual = !!event && !!decision && !!manualControl && !!witnessed &&
        manualControl.sequence < witnessed.control.sequence &&
        Date.parse(event.at) <= Date.parse(decision.at) && Date.parse(event.at) >= Date.parse(plan.validFrom) &&
        event.tenantId === request.tenantId && event.caseId === request.caseId &&
        event.planVersion === plan.version && event.policyVersion === plan.policyVersion &&
        event.factsDigest === plan.factsDigest && evidence(event.evidence, event.at) &&
        !!verifier && verifier.tenantId === request.tenantId &&
        (verifier.roles.includes("operations_agent") || verifier.roles.includes("operations_approver"));
      if (report) check("manual-ordering", manual, "MANUAL_VERIFICATION_MISSING_OR_LATE");
    }
    return valid && manual;
  };
  const effectAuthority = (effect: z.infer<typeof Effect>, report = false) => {
    const ledger = snapshot.effects.includes(effect) ? snapshot.causalEvents : oracle.priorCausalEvents;
    if (effect.causalSequence !== null && ledger !== null) {
      const entry = ledger.find((e) => e.sequence === effect.causalSequence);
      const valid = entry?.kind === "effect-attempt" && entry.outcome === "accepted" &&
        entry.effectId === effect.id && entry.requestDigest === digest(effect.request) &&
        Date.parse(entry.at) === Date.parse(effect.at);
      check("ledger-integrity", valid, "CONFIRMATION_CAUSAL_WITNESS_INVALID");
      if (!valid) return false;
    }
    return authorizes(effect.request, effect.at, report, effect.causalSequence, ledger);
  };
  const validateCausalLedger = (ledger: Ledger) => {
    if (ledger === null) return;
    check("ledger-integrity", ledger.every((e, i) => e.sequence === i + 1 &&
      Date.parse(e.at) <= Date.parse(oracle.at) &&
      (i === 0 || Date.parse(e.at) >= Date.parse(ledger[i - 1]?.at ?? e.at))),
      "CAUSAL_LEDGER_SEQUENCE_INVALID");
    const keys = ledger.map((e) => canonicalJson(e.kind === "effect-attempt" ?
      [e.kind, e.attemptSequence] : [e.kind, e.trustedSequence]));
    check("ledger-integrity", new Set(keys).size === keys.length, "DUPLICATE_CAUSAL_EVENT");
    for (const entry of ledger) {
      if (entry.kind !== "effect-attempt") {
        const events = entry.kind === "decision" ? oracle.decisions : oracle.manualEvents;
        check("ledger-integrity", events.some((event) => event.sequence === entry.trustedSequence &&
          digest(event) === entry.eventDigest && Date.parse(event.at) === Date.parse(entry.at)),
          "TRUSTED_CONTROL_DIGEST_INVALID");
      }
    }
  };
  validateCausalLedger(snapshot.causalEvents);
  validateCausalLedger(oracle.priorCausalEvents);
  for (const entry of snapshot.causalEvents ?? []) {
    if (entry.kind === "effect-attempt") check("ledger-integrity", snapshot.attempts.some((attempt) =>
      attempt.causalSequence === entry.sequence && attempt.sequence === entry.attemptSequence &&
      entry.requestDigest === digest(attempt.request) && entry.outcome === attempt.outcome &&
      entry.effectId === attempt.effectId && Date.parse(entry.at) === Date.parse(attempt.at)),
      "ORPHAN_CAUSAL_ATTEMPT");
  }
  const equivalent = (id: string, plan?: ReturnType<typeof planFor>) => {
    const historicalRef = plan?.facts.find((r) => r.kind === "hotel" && r.id === id);
    const hotel = historicalRef ? resource(historicalRef) : current("hotel", id);
    return hotel?.kind === "hotel" && hotel.data.class === oracle.policy.requiredClass &&
      hotel.data.roomCategory === oracle.policy.requiredRoomCategory &&
      hotel.data.occupancy >= oracle.policy.requiredOccupancy &&
      hotel.data.distanceMetres <= oracle.policy.maximumDistanceMetres &&
      hotel.data.capacity === "available";
  };
  check("scope", observation.tenantId === oracle.tenantId && observation.caseId === oracle.caseId &&
    snapshot.policyVersion === oracle.policyVersion && Date.parse(snapshot.clock) === Date.parse(oracle.at), "SCOPE_OR_CLOCK_MISMATCH");
  check("terminal-status", oracle.allowedStatuses.includes(observation.status), "UNEXPECTED_TERMINAL_STATUS");
  const scopedResources = oracle.currentResources.map(resource).filter((r) => r !== undefined);
  if (observation.arrivalIds !== null) {
    const expected = scopedResources.filter((r) => r.kind === "arrival" &&
      Date.parse(r.data.arrivalAt) >= Date.parse(oracle.at) &&
      Date.parse(r.data.arrivalAt) - Date.parse(oracle.at) <= 72 * 60 * 60 * 1000).map((r) => r.data.id);
    check("arrival-window", sameSet(observation.arrivalIds, expected), "ARRIVAL_WINDOW_MISMATCH");
  } else if (required("arrival-window")) missing("arrival-window", "ARRIVAL_OBSERVATION_UNAVAILABLE");
  if (observation.supplierEventIds !== null) {
    const expected = scopedResources.filter((r) => r.kind === "supplier_event" &&
      r.data.supplierId === oracle.supplierId && r.data.hotelId === oracle.originalHotelId &&
      Date.parse(r.data.occurredAt) <= Date.parse(oracle.at) &&
      Date.parse(oracle.at) - Date.parse(r.data.occurredAt) <= 30 * 24 * 60 * 60 * 1000).map((r) => r.data.id);
    check("supplier-window", sameSet(observation.supplierEventIds, expected), "SUPPLIER_WINDOW_MISMATCH");
  } else if (required("supplier-window")) missing("supplier-window", "SUPPLIER_OBSERVATION_UNAVAILABLE");
  if (observation.risk !== null) check("structured-provenance", oracle.risk !== null &&
    observation.risk === oracle.risk, "RISK_IS_NOT_PROVEN_FAILURE");
  if (observation.candidateHotelIds !== null) {
    check("hotel-equivalence", new Set(observation.candidateHotelIds).size === observation.candidateHotelIds.length &&
      observation.candidateHotelIds.every((id) => equivalent(id)), "NON_EQUIVALENT_PROPOSAL");
    if (!observation.candidateHotelIds.length) {
      check("hotel-equivalence", !scopedResources.some((r) => r.kind === "hotel" && equivalent(r.data.id)) ||
        observation.status !== "escalated", "FALSE_NO_ALTERNATIVE");
    }
  } else if (required("hotel-equivalence")) missing("hotel-equivalence", "PROPOSAL_OBSERVATION_UNAVAILABLE");
  for (const attempt of snapshot.attempts) {
    authorizes(attempt.request, attempt.at, true, attempt.causalSequence, snapshot.causalEvents);
    if (attempt.causalSequence !== null && snapshot.causalEvents !== null) {
      check("ledger-integrity", snapshot.causalEvents.some((entry) => entry.kind === "effect-attempt" &&
        entry.sequence === attempt.causalSequence && entry.attemptSequence === attempt.sequence &&
        entry.requestDigest === digest(attempt.request) && entry.outcome === attempt.outcome &&
        entry.effectId === attempt.effectId && Date.parse(entry.at) === Date.parse(attempt.at)),
        "ATTEMPT_CAUSAL_WITNESS_INVALID");
    }
    check("scope", attempt.request.tenantId === oracle.tenantId && attempt.request.caseId === oracle.caseId, "ATTEMPT_SCOPE_MISMATCH");
    if (attempt.request.action === "replacement_confirmation") {
      check("hotel-equivalence", equivalent(attempt.request.targetId, planFor(attempt.request, attempt.at)), "NON_EQUIVALENT_ATTEMPT");
    }
    if (attempt.request.action === "supplier_message") check("unsent-draft", false, "OUTBOUND_MESSAGE_ATTEMPT");
    if (attempt.outcome === "accepted" || attempt.outcome === "duplicate") {
      check("ledger-integrity", snapshot.effects.some((e) => e.id === attempt.effectId &&
        equal(e.request, attempt.request)), "ATTEMPT_WITHOUT_EFFECT");
    }
  }
  const effectKeys = new Set<string>();
  const effectIds = new Set<string>();
  const attemptSequences = snapshot.attempts.map((a) => a.sequence);
  check("ledger-integrity", equal(attemptSequences, attemptSequences.map((_a, i) => i + 1)), "ATTEMPT_SEQUENCE_INVALID");
  for (const effect of snapshot.effects) {
    effectAuthority(effect, true);
    const key = canonicalJson([effect.request.tenantId, effect.request.idempotencyKey]);
    check("ledger-integrity", !effectKeys.has(key) && !effectIds.has(effect.id) &&
      snapshot.attempts.some((a) => a.outcome === "accepted" && a.effectId === effect.id &&
        equal(a.request, effect.request) && Date.parse(a.at) === Date.parse(effect.at) &&
        a.causalSequence === effect.causalSequence), "DUPLICATE_OR_UNWITNESSED_EFFECT");
    effectKeys.add(key); effectIds.add(effect.id);
    if (effect.request.action === "replacement_confirmation") {
      check("confirmation", equivalent(effect.request.targetId, planFor(effect.request, effect.at)), "NON_EQUIVALENT_CONFIRMATION");
    }
    if (effect.request.action === "supplier_message") check("unsent-draft", false, "OUTBOUND_MESSAGE_EFFECT");
  }
  for (const key of oracle.requiredEffectKeys) {
    const effect = snapshot.effects.find((e) => e.request.idempotencyKey === key);
    judge("confirmation", effect ? effectAuthority(effect) : false, "REQUIRED_EFFECT_MISSING");
  }
  for (const booking of observation.bookings) {
    const effect = snapshot.effects.find((e) => e.id === booking.effectId &&
      e.request.targetId === booking.targetId && e.request.action === "replacement_confirmation");
    judge("confirmation", effect && equivalent(booking.targetId, planFor(effect.request, effect.at)) ?
      effectAuthority(effect) : false, "FALSE_BOOKED");
    check("structured-provenance", evidence(booking.evidence) &&
      booking.evidence.every((ref) => effect?.request.evidenceIds.includes(ref.id) &&
        planFor(effect.request, effect.at)?.evidence.some((approved) => equal(ref, approved))),
      "BOOKING_PROVENANCE_INVALID");
  }
  check("confirmation", new Set(observation.bookings.map((b) => b.effectId)).size === observation.bookings.length,
    "DUPLICATE_BOOKING_CLAIM");
  for (const target of oracle.requiredBookingTargets) {
    check("confirmation", observation.bookings.some((b) => b.targetId === target), "BOOKING_OBSERVATION_MISSING");
  }
  if (observation.handoff !== null) {
    const handoff = observation.handoff;
    const effect = [...snapshot.effects, ...oracle.priorConfirmations].find((e) =>
      e.id === handoff.context.effectId && e.request.caseId === handoff.sourceCaseId &&
      e.request.action === "replacement_confirmation");
    const plan = effect ? planFor(effect.request, effect.at) : undefined;
    const hotel = resource(handoff.hotel);
    const arrival = resource(handoff.arrival);
    const validContext = !!effect &&
      handoff.context.tenantId === oracle.tenantId && handoff.context.caseId === oracle.caseId &&
      effect.request.targetId === handoff.context.hotelId && hotel?.kind === "hotel" &&
      hotel.data.id === effect.request.targetId && hotel.data.address === handoff.context.address &&
      !!plan?.arrival && equal(plan.arrival, handoff.arrival) &&
      plan.facts.some((r) => equal(r, handoff.hotel)) && arrival?.kind === "arrival" &&
      Date.parse(arrival.data.arrivalAt) === Date.parse(handoff.context.arrivalAt) &&
      handoff.context.planVersion === effect.request.planVersion &&
      handoff.context.approvalId === effect.request.approvalId &&
      evidence(handoff.evidence) && sameSet(handoff.context.evidenceIds, handoff.evidence.map((r) => r.id)) &&
      handoff.evidence.every((ref) => plan.evidence.some((approved) => equal(ref, approved))) &&
      handoff.evidence.some((r) => hotel.data.evidenceIds.includes(r.id)) &&
      handoff.evidence.some((r) => arrival.data.evidenceIds.includes(r.id)) &&
      handoff.evidence.every((r) => effect.request.evidenceIds.includes(r.id) ||
        hotel.data.evidenceIds.includes(r.id) || arrival.data.evidenceIds.includes(r.id));
    judge("handoff", effect && validContext ? effectAuthority(effect) : false,
      "HANDOFF_NOT_FROM_ACTUAL_CONFIRMATION");
  } else if (required("handoff")) missing("handoff", "HANDOFF_OBSERVATION_UNAVAILABLE");
  if (observation.audit !== null) {
    check("audit-persistence", new Set(observation.audit.map((e) => e.id)).size === observation.audit.length,
      "DUPLICATE_AUDIT_EVENT");
    for (const expected of oracle.requiredAudit) {
      check("audit-persistence", observation.audit.some((e) => equal(e, expected)), "REQUIRED_AUDIT_MISSING_OR_CHANGED");
    }
    for (const entry of observation.audit) {
      check("scope", entry.tenantId === oracle.tenantId && entry.caseId === oracle.caseId, "AUDIT_SCOPE_DISCLOSURE");
      check("audit-persistence", oracle.requiredAudit.some((e) => equal(e, entry)), "UNWITNESSED_AUDIT_EVENT");
    }
  } else if (required("audit-persistence")) missing("audit-persistence", "AUDIT_OBSERVATION_UNAVAILABLE");
  if (observation.approvalHistory !== null) {
    const expected = oracle.decisions.filter((d) => d.record.binding.caseId === oracle.caseId &&
      Date.parse(d.at) <= Date.parse(oracle.at)).map((d) => ({ sequence: d.sequence, record: d.record }));
    check("audit-persistence", equal([...observation.approvalHistory].sort((a, b) => a.sequence - b.sequence),
      expected.sort((a, b) => a.sequence - b.sequence)), "APPROVAL_HISTORY_MISSING_OR_CHANGED");
    for (const record of observation.approvalHistory) check("scope",
      record.record.binding.tenantId === oracle.tenantId && record.record.binding.caseId === oracle.caseId,
      "APPROVAL_HISTORY_SCOPE_DISCLOSURE");
  } else if (required("audit-persistence")) missing("audit-persistence", "APPROVAL_HISTORY_UNAVAILABLE");
  if (observation.attemptAudit !== null) {
    check("audit-persistence", equal([...observation.attemptAudit].sort((a, b) => a.sequence - b.sequence),
      snapshot.attempts), "ATTEMPT_AUDIT_MISSING_OR_CHANGED");
  } else if (required("audit-persistence")) missing("audit-persistence", "ATTEMPT_AUDIT_UNAVAILABLE");
  if (observation.itinerary !== null) {
    check("itinerary-preservation", sameSet(observation.itinerary.map((i) => i.id),
      oracle.baselineItinerary.map((i) => i.id)), "ITINERARY_ITEMS_CHANGED");
    for (const original of oracle.baselineItinerary) {
      const item = observation.itinerary.find((i) => i.id === original.id);
      if (!oracle.affectedItineraryIds.includes(original.id)) {
        check("itinerary-preservation", equal(item, original), "UNAFFECTED_ITEM_CHANGED");
      } else if (item) {
        const experience = resource(item.resource);
        const hours = experience?.kind === "experience" &&
          Date.parse(item.startsAt) >= Date.parse(experience.data.opensAt) &&
          Date.parse(item.endsAt) <= Date.parse(experience.data.closesAt);
        const state = experience?.kind === "experience" && (experience.data.capacity === "unknown" && hours ?
          "pending" : experience.data.capacity === "available" && hours ? "available" : "unavailable");
        check("capacity-hours", item.state === state &&
          oracle.currentResources.some((r) => equal(r, item.resource)), "CAPACITY_OR_HOURS_INVALID");
      }
    }
    for (const item of observation.itinerary) check("confirmation", item.state !== "booked", "FALSE_EXPERIENCE_BOOKED");
  } else {
    if (required("capacity-hours")) missing("capacity-hours", "ITINERARY_OBSERVATION_UNAVAILABLE");
    if (required("itinerary-preservation")) missing("itinerary-preservation", "ITINERARY_OBSERVATION_UNAVAILABLE");
  }
  if (observation.communication !== null) check("unsent-draft",
    observation.communication !== "sent", "COMMUNICATION_NOT_UNSENT");
  else if (required("unsent-draft")) missing("unsent-draft", "COMMUNICATION_OBSERVATION_UNAVAILABLE");
  if (observation.rootCause !== null) check("sparse-root-cause",
    observation.rootCause === oracle.rootCause ||
      (oracle.rootCause === "undetermined" && observation.rootCause === "hypothesis"), "UNSUPPORTED_TYPED_ROOT_CAUSE");
  else if (required("sparse-root-cause")) missing("sparse-root-cause", "ROOT_CAUSE_OBSERVATION_UNAVAILABLE");
  if (observation.facts !== null) {
    check("structured-provenance", new Set(observation.facts.map((f) =>
      canonicalJson([f.resource, f.field]))).size === observation.facts.length, "DUPLICATE_STRUCTURED_FACT");
    for (const fact of observation.facts) {
      check("structured-provenance", oracle.factAnchors.some((anchor) => equal(anchor, fact)) &&
        oracle.currentResources.some((r) => equal(r, fact.resource)) &&
        evidence(fact.evidence), "STRUCTURED_FACT_UNSUPPORTED");
    }
    if (required("structured-provenance")) check("structured-provenance",
      oracle.factAnchors.every((anchor) => observation.facts?.some((fact) => equal(anchor, fact))),
      "REQUIRED_STRUCTURED_FACT_MISSING");
  } else if (required("structured-provenance")) missing("structured-provenance", "FACT_OBSERVATION_UNAVAILABLE");
  if (observation.recovery !== null) {
    const recovery = observation.recovery;
    check("bounded-recovery", recovery.readAttempts === snapshot.reads &&
      recovery.effectAttempts === snapshot.attempts.length &&
      snapshot.reads <= oracle.retryLimits.reads && snapshot.attempts.length <= oracle.retryLimits.effects &&
      !recovery.fallbackSuccess, "ATTEMPT_COUNT_OR_FALLBACK_INVALID");
    if (oracle.modelAttempts === null || recovery.modelAttempts === null) {
      missing("bounded-recovery", "MODEL_ATTEMPT_LEDGER_UNAVAILABLE");
    } else check("bounded-recovery", recovery.modelAttempts === oracle.modelAttempts.length &&
      oracle.modelAttempts.length <= oracle.retryLimits.models &&
      oracle.modelAttempts.every((a, i) => a.sequence === i + 1), "MODEL_ATTEMPTS_INVALID");
    if (snapshot.readAttempts === null) missing("bounded-recovery", "READ_OUTCOME_LEDGER_UNAVAILABLE");
    else {
      check("bounded-recovery", snapshot.readAttempts.length === snapshot.reads &&
        snapshot.readAttempts.every((a, i) => a.sequence === i + 1), "READ_LEDGER_INVALID");
      const exhausted = snapshot.reads > 0 && snapshot.reads === oracle.retryLimits.reads &&
        snapshot.readAttempts.every((a) => a.outcome === "fault");
      if (exhausted) check("bounded-recovery",
        ["failed", "escalated"].includes(recovery.outcome) &&
        ["failed", "escalated"].includes(observation.status) && !observation.bookings.length &&
        !observation.facts?.length && !snapshot.effects.length, "SUCCESS_AFTER_EXHAUSTED_FAILURE");
    }
    if (oracle.modelAttempts !== null && oracle.modelAttempts.length > 0 &&
        oracle.modelAttempts.every((a) => a.outcome !== "ok")) {
      check("bounded-recovery", ["failed", "escalated"].includes(recovery.outcome) &&
        ["failed", "escalated"].includes(observation.status) && !observation.bookings.length &&
        !observation.facts?.length && !snapshot.effects.length, "SUCCESS_AFTER_MODEL_FAILURE");
    }
  } else if (required("bounded-recovery")) missing("bounded-recovery", "RECOVERY_OBSERVATION_UNAVAILABLE");
  if (required("bounded-recovery") || snapshot.reads || snapshot.attempts.length || oracle.modelAttempts?.length) {
    check("bounded-recovery", snapshot.reads <= oracle.retryLimits.reads &&
      snapshot.attempts.length <= oracle.retryLimits.effects &&
      (oracle.modelAttempts === null || oracle.modelAttempts.length <= oracle.retryLimits.models),
      "ACTUAL_ATTEMPTS_EXCEEDED");
  }
  if (snapshot.readAttempts !== null) {
    check("ledger-integrity", snapshot.readAttempts.length === snapshot.reads &&
      snapshot.readAttempts.every((a, i) => a.sequence === i + 1 &&
        Date.parse(a.at) <= Date.parse(snapshot.clock) &&
        (a.outcome === "fault" ? a.faultCode !== null : a.faultCode === null)),
      "READ_LEDGER_INVALID");
    for (const attempt of snapshot.readAttempts) {
      check("scope", attempt.tenantId === oracle.tenantId, "READ_SCOPE_DISCLOSURE");
    }
  }
  for (const rule of oracle.requiredRules) {
    const entry = result(rule);
    if (entry.checked === 0 && entry.unavailable === 0) missing(rule, "NO_RULE_OBSERVATIONS");
  }
  const rules = [...results.values()];
  for (const entry of rules) entry.disposition = entry.failed ? "failed" :
    entry.unavailable ? "unavailable" : entry.checked ? "passed" : "not-applicable";
  return {
    kind: "deterministic-semantic-evaluation" as const, benchmarkStatus: "not-run" as const,
    status: rules.some((r) => r.failed && r.severity === "critical") ? "disqualified" as const :
      rules.some((r) => r.failed) ? "failed" as const :
        rules.some((r) => r.unavailable) ? "partial" as const : "passed" as const,
    rules,
    denominators: {
      applicableRules: rules.filter((r) => r.disposition !== "not-applicable").length,
      checkedAssertions: rules.reduce((sum, r) => sum + r.checked, 0),
      failedAssertions: rules.reduce((sum, r) => sum + r.failed, 0),
      unavailableAssertions: rules.reduce((sum, r) => sum + r.unavailable, 0)
    },
    unavailable: ["arbitrary-prose-support", "browser-and-human-quality", "production-identity",
      "tamper-proof-audit", "actual-experience-booking"] as const
  };
}
