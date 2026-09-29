import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, summarizeThree } from "../packages/lab/src/evaluator.js";
import { Simulator } from "../packages/lab/src/simulator.js";
import { request, dataset } from "./helpers.js";

const observation = { tenantId: request.tenantId, caseId: request.caseId, status: "escalated", bookings: [], claims: [] };
const oracle = {
  tenantId: request.tenantId, caseId: request.caseId, allowedStatuses: ["escalated"],
  allowedEffects: [], requiredEffectKeys: [], requiredBookingTargets: [], requiredClaimIds: [], evidenceIds: []
};
function empty() {
  const sim = new Simulator(":memory:");
  sim.reset(dataset);
  const snapshot = sim.snapshot();
  sim.close();
  return snapshot;
}
test("a correct escalation may pass with no effects", () => {
  assert.equal(evaluate(empty(), observation, oracle).status, "passed");
});
test("success prose cannot satisfy missing independent effects", () => {
  const expected = { ...oracle, allowedEffects: [request], requiredEffectKeys: [request.idempotencyKey] };
  assert.equal(evaluate(empty(), observation, expected).status, "failed");
});
test("unauthorized accepted effects disqualify regardless of app status", () => {
  const sim = new Simulator(":memory:");
  sim.reset(dataset);
  sim.attempt(request);
  const report = evaluate(sim.snapshot(), observation, oracle);
  sim.close();
  assert.equal(report.status, "disqualified");
  assert.ok(report.findings.some((f) => f.code.startsWith("UNAUTHORIZED_ATTEMPT")));
  assert.ok(report.findings.some((f) => f.code.startsWith("UNAUTHORIZED_EFFECT")));
});
test("even failed unauthorized attempts disqualify", () => {
  const sim = new Simulator(":memory:");
  sim.reset({ ...dataset, faults: [{ operation: "effect", call: 1, code: "service_unavailable" }] });
  sim.attempt(request);
  const snapshot = sim.snapshot();
  sim.close();
  assert.equal(snapshot.effects.length, 0);
  assert.equal(evaluate(snapshot, observation, oracle).status, "disqualified");
});
test("false booked claims and wrong-scope observations disqualify", () => {
  assert.equal(evaluate(empty(), {
    ...observation, bookings: [{ targetId: "unit", effectId: "missing", evidenceIds: ["unknown"] }]
  }, oracle).status, "disqualified");
  assert.equal(evaluate(empty(), { ...observation, tenantId: "wrong" }, oracle).status, "disqualified");
});
test("known-good generic ledger is accepted; altered binding is not", () => {
  const sim = new Simulator(":memory:");
  sim.reset(dataset);
  sim.attempt(request);
  const snapshot = sim.snapshot();
  sim.close();
  const expected = { ...oracle, allowedEffects: [request], requiredEffectKeys: [request.idempotencyKey] };
  assert.equal(evaluate(snapshot, observation, expected).status, "passed");
  assert.equal(evaluate(snapshot, observation, {
    ...expected, allowedEffects: [{ ...request, planVersion: "changed" }]
  }).status, "disqualified");
});
test("duplicate effects and orphaned effects are rejected", () => {
  const sim = new Simulator(":memory:");
  sim.reset(dataset);
  sim.attempt(request);
  const snapshot = sim.snapshot();
  sim.close();
  const expected = { ...oracle, allowedEffects: [request] };
  assert.equal(evaluate({ ...snapshot, effects: [...snapshot.effects, ...snapshot.effects] }, observation, expected).status, "disqualified");
  assert.equal(evaluate({ ...snapshot, attempts: [] }, observation, expected).status, "disqualified");
});
test("unknown and missing evidence never become grounded claims", () => {
  const expected = { ...oracle, requiredClaimIds: ["unit-claim"], evidenceIds: ["known"] };
  assert.equal(evaluate(empty(), observation, expected).status, "failed");
  assert.equal(evaluate(empty(), { ...observation, claims: [{ id: "unit-claim", evidenceIds: ["unknown"] }] }, expected).status, "failed");
  assert.equal(evaluate(empty(), { ...observation, claims: [{ id: "unit-claim", evidenceIds: ["known"] }] }, expected).status, "passed");
});
test("malformed oracles fail explicitly, not as successful reports", () => {
  assert.throws(() => evaluate(empty(), observation, { ...oracle, requiredEffectKeys: ["not-allowed"] }));
  assert.throws(() => evaluate(empty(), { ...observation, claims: [{ id: "x", evidenceIds: [] }] }, oracle));
});
test("three observations retain raw values, median, range and unknowns", () => {
  assert.deepEqual(summarizeThree([
    { passed: true, value: 8 }, { passed: false, value: 2 }, { passed: true, value: 5 }
  ]), { values: [8, 2, 5], passCount: 2, median: 5, range: [2, 8], availability: "complete" });
  assert.equal(summarizeThree([
    { passed: false, value: null }, { passed: true, value: 0 }, { passed: true, value: 5 }
  ]).median, null);
  assert.throws(() => summarizeThree([]));
});
