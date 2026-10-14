import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { evaluate } from "../packages/lab/src/evaluator.js";
import { Simulator } from "../packages/lab/src/simulator.js";
import { simulatorServer } from "../packages/lab/src/simulator-server.js";
import { digest } from "../packages/lab/src/encoding.js";
import { evaluateSemantic } from "../packages/lab/src/semantic-evaluator.js";
import { semanticVector } from "./semantic-helpers.js";
import { dataset, request, sandbox, clock } from "./helpers.js";

test("snapshot is one read transaction when another connection commits between ledger reads", (t) => {
  const space = sandbox(t);
  const control = space.keep(new DatabaseSync(space.path));
  control.exec("PRAGMA journal_mode=WAL");
  const reader = space.keep(new Simulator(space.path));
  const writer = space.keep(new Simulator(space.path));
  reader.reset(dataset);
  const prepare = DatabaseSync.prototype.prepare;
  let interleaved = false;
  t.mock.method(DatabaseSync.prototype, "prepare", function(this: DatabaseSync, sql: string) {
    const statement = prepare.call(this, sql);
    if (sql === "SELECT data FROM sim_attempts ORDER BY sequence" && !interleaved) {
      const all = statement.all;
      t.mock.method(statement, "all", () => {
        const rows = all.call(statement, {});
        interleaved = true;
        writer.advanceTo("2000-01-01T00:01:00.000Z");
        writer.attempt(request);
        return rows;
      });
    }
    return statement;
  });
  const snapshot = reader.snapshot();
  assert.equal(interleaved, true);
  assert.equal(snapshot.attempts.length, 0);
  assert.equal(snapshot.effects.length, 0);
  assert.deepEqual(snapshot.causalEvents, []);
  assert.equal(snapshot.clock, clock);
  assert.equal(evaluate(snapshot, {
    tenantId: request.tenantId, caseId: request.caseId, status: "running", bookings: [], claims: []
  }, {
    tenantId: request.tenantId, caseId: request.caseId, allowedStatuses: ["running"],
    allowedEffects: [request], requiredEffectKeys: [], requiredBookingTargets: [],
    requiredClaimIds: [], evidenceIds: request.evidenceIds
  }).status, "passed");
  const next = reader.snapshot();
  assert.equal(next.attempts.length, 1);
  assert.equal(next.effects.length, 1);
  assert.equal(next.causalEvents?.length, 1);
  assert.equal(next.clock, "2000-01-01T00:01:00.000Z");
});
test("simulator requires initialization; attempts without approvals are visible, never delivered", (t) => {
  const space = sandbox(t);
  const sim = space.keep(new Simulator(space.path));
  assert.throws(() => sim.snapshot(), /initialized/);
  sim.reset(dataset);
  assert.equal(sim.attempt(request).outcome, "accepted");
  assert.equal(sim.snapshot().effects[0]?.delivered, false);
  assert.equal(sim.snapshot().attempts[0]?.request.approvalId, null);
});
test("same-key retries are idempotent, changed payload conflicts, all attempts persist", (t) => {
  const space = sandbox(t);
  let sim = space.keep(new Simulator(space.path));
  sim.reset(dataset);
  const first = sim.attempt(request);
  sim.close();
  sim = space.keep(new Simulator(space.path));
  assert.equal(sim.attempt({ ...request }).effectId, first.effectId);
  assert.equal(sim.attempt({ ...request, targetId: "different" }).outcome, "conflict");
  assert.equal(sim.snapshot().attempts.length, 3);
  assert.equal(sim.snapshot().effects.length, 1);
});
test("idempotency keys are tenant-scoped", (t) => {
  const space = sandbox(t);
  const sim = space.keep(new Simulator(space.path));
  sim.reset(dataset);
  sim.attempt(request);
  sim.attempt({ ...request, tenantId: "another-unit-tenant" });
  assert.equal(sim.snapshot().effects.length, 2);
});
test("fault schedule survives restart and reset reproduces exact results", (t) => {
  const space = sandbox(t);
  let sim = space.keep(new Simulator(space.path));
  const data = { ...dataset, faults: [{ operation: "effect", call: 2, code: "service_unavailable" }] };
  sim.reset(data);
  const first = sim.attempt(request);
  sim.close();
  sim = space.keep(new Simulator(space.path));
  const failed = sim.attempt({ ...request, idempotencyKey: "unit-second" });
  assert.equal(failed.outcome, "fault");
  assert.equal(sim.snapshot().effects.length, 1);
  sim.reset(data);
  assert.deepEqual(sim.attempt(request), first);
  assert.deepEqual(sim.attempt({ ...request, idempotencyKey: "unit-second" }), failed);
});
test("reads filter tenant and retain distinct resource revisions", (t) => {
  const space = sandbox(t);
  const sim = space.keep(new Simulator(space.path));
  const make = (revision: string, tenantId = request.tenantId) => ({
    revision, resource: { kind: "evidence", data: {
      id: "unit", tenantId, source: "direct", sourceRef: "unit",
      version: revision, observedAt: clock, statement: "Synthetic protocol fixture"
    } }
  });
  sim.reset({ ...dataset, fixtures: [make("v1"), make("v2"), make("v1", "other")] });
  const result = sim.read(request.tenantId, "evidence");
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.fixtures.length, 2);
});
test("read failures are explicit; retry counts and clock are durable", (t) => {
  const space = sandbox(t);
  let sim = space.keep(new Simulator(space.path));
  sim.reset({ ...dataset, faults: [{ operation: "read", call: 1, code: "retrieval_failure" }] });
  assert.deepEqual(sim.read("unit", "hotel"), { status: "fault", code: "retrieval_failure" });
  sim.advanceTo("2000-01-01T00:01:00.000Z");
  assert.throws(() => sim.advanceTo(clock), /backwards/);
  sim.close();
  sim = space.keep(new Simulator(space.path));
  assert.equal(sim.read("unit", "hotel").status, "ok");
  assert.equal(sim.snapshot().reads, 2);
  assert.deepEqual(sim.snapshot().readAttempts, [
    { sequence: 1, at: clock, tenantId: "unit", kind: "hotel", outcome: "fault", faultCode: "retrieval_failure" },
    { sequence: 2, at: "2000-01-01T00:01:00.000Z", tenantId: "unit", kind: "hotel", outcome: "ok", faultCode: null }
  ]);
  assert.equal(sim.snapshot().clock, "2000-01-01T00:01:00.000Z");
});
test("duplicate faults and malformed reset fail without destroying existing state", (t) => {
  const space = sandbox(t);
  const sim = space.keep(new Simulator(space.path));
  sim.reset(dataset);
  sim.attempt(request);
  const fault = { operation: "read", call: 1, code: "retrieval_failure" };
  assert.throws(() => sim.reset({ ...dataset, faults: [fault, fault] }));
  assert.equal(sim.snapshot().effects.length, 1);
});
test("legacy read counts remain explicitly unavailable until a clean reset, never invented as zero", (t) => {
  const space = sandbox(t);
  const sim = space.keep(new Simulator(space.path)); sim.reset(dataset);
  const control = space.keep(new DatabaseSync(space.path));
  control.exec("UPDATE sim_meta SET reads=2");
  assert.equal(sim.snapshot().reads, 2);
  assert.equal(sim.snapshot().readAttempts, null);
  sim.read("unit", "hotel");
  assert.equal(sim.snapshot().readAttempts, null);
  sim.reset(dataset);
  assert.deepEqual(sim.snapshot().readAttempts, []);
});
test("HTTP simulator returns protocol errors, conflicts and fault codes", async (t) => {
  const space = sandbox(t);
  const sim = space.keep(new Simulator(space.path));
  sim.reset(dataset);
  const app = simulatorServer(sim);
  try {
    assert.equal((await app.inject({ method: "POST", url: "/effects", payload: { ...request, role: "admin" } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/effects", payload: request })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/effects", payload: { ...request, caseId: "different" } })).statusCode, 409);
    assert.equal((await app.inject("/resources/unit/unsupported")).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/reset" })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/trusted-control", payload: {
      kind: "decision", trustedSequence: 1, eventDigest: "0".repeat(64)
    } })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/effects",
      payload: { ...request, causalSequence: 1 } })).statusCode, 400);
  } finally { await app.close(); }
});
test("trusted control order, replay and original effect provenance survive service reopen", (t) => {
  const space = sandbox(t); let sim = space.keep(new Simulator(space.path));
  const v = semanticVector(); const decision = v.oracle.decisions[0]; const effectRequest = v.snapshot.attempts[0]?.request;
  assert.ok(decision && effectRequest && v.observation.handoff && v.observation.bookings[0] && v.observation.recovery);
  sim.reset({ ...dataset, fixtures: v.oracle.fixtures });
  const control = { kind: "decision", trustedSequence: decision.sequence, eventDigest: digest(decision) };
  const grant = sim.recordTrustedControl(control); const accepted = sim.attempt(effectRequest);
  sim.close(); sim = space.keep(new Simulator(space.path));
  assert.deepEqual(sim.recordTrustedControl(control), grant);
  const retry = sim.attempt(effectRequest);
  assert.equal(retry.outcome, "duplicate"); assert.equal(retry.causalSequence, 3);
  assert.equal(sim.snapshot().effects[0]?.causalSequence, accepted.causalSequence);
  v.snapshot = sim.snapshot(); v.observation.attemptAudit = v.snapshot.attempts;
  v.observation.recovery.effectAttempts = 2;
  v.observation.handoff.context.effectId = accepted.effectId ?? "unit-missing";
  v.observation.bookings[0].effectId = accepted.effectId ?? "unit-missing";
  assert.equal(evaluateSemantic(v.snapshot, v.observation, v.oracle).status, "passed");
  const cancelled = { ...structuredClone(decision), sequence: 3,
    record: { ...structuredClone(decision.record), status: "cancelled" as const } };
  v.oracle.decisions.push(cancelled);
  sim.recordTrustedControl({ kind: "decision", trustedSequence: 3, eventDigest: digest(cancelled) });
  sim.close(); sim = space.keep(new Simulator(space.path));
  assert.deepEqual(sim.recordTrustedControl(control), grant);
  assert.throws(() => sim.recordTrustedControl({ ...control, eventDigest: "0".repeat(64) }), /TRUSTED_CONTROL_CONFLICT/);
  assert.equal(sim.snapshot().causalEvents?.length, 4);
  sim.attempt(effectRequest);
  v.snapshot = sim.snapshot(); v.observation.attemptAudit = v.snapshot.attempts;
  v.observation.recovery.effectAttempts = 3;
  v.observation.approvalHistory = v.oracle.decisions.map((d) => ({ sequence: d.sequence, record: d.record }));
  const result = evaluateSemantic(v.snapshot, v.observation, v.oracle);
  assert.equal(result.status, "disqualified");
  assert.equal(result.rules.find((r) => r.rule === "confirmation")?.disposition, "passed");
  assert.equal(result.rules.find((r) => r.rule === "handoff")?.disposition, "passed");
});
test("legacy effect rows are not assigned a fabricated causal history on reopen", (t) => {
  const space = sandbox(t); let sim = space.keep(new Simulator(space.path)); sim.reset(dataset);
  sim.attempt(request);
  const control = space.keep(new DatabaseSync(space.path));
  control.exec(`
    DELETE FROM sim_causal_events;
    UPDATE sim_attempts SET data=json_remove(data, '$.causalSequence');
    UPDATE sim_effects SET data=json_remove(data, '$.causalSequence');
  `);
  sim.close(); sim = space.keep(new Simulator(space.path));
  assert.equal(sim.snapshot().attempts[0]?.causalSequence, null);
  assert.equal(sim.snapshot().effects[0]?.causalSequence, null);
  assert.deepEqual(sim.snapshot().causalEvents, []);
  const retry = sim.attempt(request);
  assert.equal(retry.causalSequence, 1);
  assert.equal(sim.snapshot().effects[0]?.causalSequence, null);
});
