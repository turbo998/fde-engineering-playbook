import test from "node:test";
import assert from "node:assert/strict";
import { Simulator } from "../packages/lab/src/simulator.js";
import { simulatorServer } from "../packages/lab/src/simulator-server.js";
import { dataset, request, sandbox, clock } from "./helpers.js";

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
  } finally { await app.close(); }
});
