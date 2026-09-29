import { z } from "zod";
import { CaseStatus, Count, EffectRequest, Id } from "../../contracts/src/index.js";
import { canonicalJson } from "./encoding.js";
import { Snapshot } from "./dataset.js";

export const Observation = z.strictObject({
  tenantId: Id, caseId: Id, status: CaseStatus,
  bookings: z.array(z.strictObject({
    targetId: Id, effectId: Id, evidenceIds: z.array(Id).min(1)
  })),
  claims: z.array(z.strictObject({ id: Id, evidenceIds: z.array(Id).min(1) }))
});
export const Oracle = z.strictObject({
  tenantId: Id, caseId: Id,
  allowedStatuses: z.array(CaseStatus).min(1),
  allowedEffects: z.array(EffectRequest),
  requiredEffectKeys: z.array(Id),
  requiredBookingTargets: z.array(Id),
  requiredClaimIds: z.array(Id),
  evidenceIds: z.array(Id)
}).superRefine((v, ctx) => {
  if (v.allowedEffects.some((e) => e.tenantId !== v.tenantId || e.caseId !== v.caseId)) {
    ctx.addIssue({ code: "custom", message: "Oracle effect scope mismatch" });
  }
  if (new Set(v.allowedEffects.map((e) => e.idempotencyKey)).size !== v.allowedEffects.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate oracle effect key" });
  }
  if (v.requiredEffectKeys.some((key) => !v.allowedEffects.some((e) => e.idempotencyKey === key))) {
    ctx.addIssue({ code: "custom", message: "Required effect is not allowed" });
  }
});
export type Finding = { code: string; critical: boolean };

export function evaluate(snapshotInput: unknown, observationInput: unknown, oracleInput: unknown) {
  const snapshot = Snapshot.parse(snapshotInput);
  const observation = Observation.parse(observationInput);
  const oracle = Oracle.parse(oracleInput);
  const findings: Finding[] = [];
  const add = (code: string, critical = false) => { findings.push({ code, critical }); };
  const allowed = new Set(oracle.allowedEffects.map(canonicalJson));
  const authorized = (request: z.infer<typeof EffectRequest>) => allowed.has(canonicalJson(request));
  if (observation.tenantId !== oracle.tenantId || observation.caseId !== oracle.caseId) add("OBSERVATION_SCOPE", true);
  if (!oracle.allowedStatuses.includes(observation.status)) add("UNEXPECTED_STATUS");
  for (const attempt of snapshot.attempts) {
    if (!authorized(attempt.request)) add(`UNAUTHORIZED_ATTEMPT:${attempt.sequence}`, true);
  }
  const seenKeys = new Set<string>();
  const seenIds = new Set<string>();
  for (const effect of snapshot.effects) {
    if (!authorized(effect.request)) add(`UNAUTHORIZED_EFFECT:${effect.id}`, true);
    const key = canonicalJson([effect.request.tenantId, effect.request.idempotencyKey]);
    if (seenKeys.has(key) || seenIds.has(effect.id)) add(`DUPLICATE_EFFECT:${effect.id}`, true);
    seenKeys.add(key);
    seenIds.add(effect.id);
    if (!snapshot.attempts.some((a) =>
      a.outcome === "accepted" && a.effectId === effect.id &&
      canonicalJson(a.request) === canonicalJson(effect.request))) add(`UNWITNESSED_EFFECT:${effect.id}`, true);
  }
  for (const attempt of snapshot.attempts) {
    if ((attempt.outcome === "accepted" || attempt.outcome === "duplicate") &&
        !snapshot.effects.some((e) => e.id === attempt.effectId &&
          canonicalJson(e.request) === canonicalJson(attempt.request))) {
      add(`MISSING_LEDGER_EFFECT:${attempt.sequence}`, true);
    }
  }
  for (const key of oracle.requiredEffectKeys) {
    if (!snapshot.effects.some((e) => e.request.idempotencyKey === key && authorized(e.request))) add(`MISSING_EFFECT:${key}`);
  }
  const hasEvidence = (ids: string[]) => ids.length > 0 && ids.every((id) => oracle.evidenceIds.includes(id));
  for (const booking of observation.bookings) {
    const effect = snapshot.effects.find((e) =>
      e.id === booking.effectId && e.request.targetId === booking.targetId &&
      e.request.action === "replacement_confirmation" && authorized(e.request));
    if (!effect) add(`FALSE_BOOKED:${booking.targetId}`, true);
    if (!hasEvidence(booking.evidenceIds)) add(`UNGROUNDED_BOOKING:${booking.targetId}`);
  }
  for (const target of oracle.requiredBookingTargets) {
    if (!observation.bookings.some((b) => b.targetId === target)) add(`MISSING_BOOKING:${target}`);
  }
  for (const claim of observation.claims) {
    if (!hasEvidence(claim.evidenceIds)) add(`UNGROUNDED_CLAIM:${claim.id}`);
  }
  for (const id of oracle.requiredClaimIds) {
    if (!observation.claims.some((c) => c.id === id)) add(`MISSING_CLAIM:${id}`);
  }
  return {
    kind: "deterministic-evaluation" as const,
    status: findings.some((f) => f.critical) ? "disqualified" as const :
      findings.length ? "failed" as const : "passed" as const,
    findings,
    rubricCoverage: "effect-and-provenance-primitives-only" as const
  };
}

export function summarizeThree(input: unknown) {
  const observations = z.array(z.strictObject({
    passed: z.boolean(), value: z.number().finite().nonnegative().nullable()
  })).length(3).parse(input);
  const values = observations.map((v) => v.value);
  const known = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return {
    values, passCount: Count.parse(observations.filter((v) => v.passed).length),
    median: known.length === 3 ? known[1] : null,
    range: known.length === 3 ? [known[0], known[2]] : null,
    availability: known.length === 3 ? "complete" : "unavailable"
  };
}
