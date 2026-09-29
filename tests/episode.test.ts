import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import Fastify from "fastify";
import { Simulator } from "../packages/lab/src/simulator.js";
import { simulatorServer } from "../packages/lab/src/simulator-server.js";
import { EpisodeScript, OfflineHttpAdapter, runOfflineEpisode, type ApplicationTestAdapter } from "../packages/lab/src/episode.js";
import { dataset, request, sandbox } from "./helpers.js";

const accepted = { httpStatus: 200, status: "accepted" };
const event = (id: string, type: string, body: unknown = null, expected = accepted) =>
  ({ kind: "event", event: { id, tenantId: request.tenantId, caseId: request.caseId, type, body }, expected });
const approval = (sessionRef: string) => ({
  kind: "approval", sessionRef, command: {
    id: `command-${sessionRef}`, tenantId: request.tenantId, caseId: request.caseId,
    approvalId: "unit-approval", decision: "approved", planVersion: request.planVersion
  }, expected: sessionRef === "unit-authorized-session" ? accepted : { httpStatus: 403, status: "rejected" }
});
const oracle = {
  tenantId: request.tenantId, caseId: request.caseId, allowedStatuses: ["completed"],
  allowedEffects: [request], requiredEffectKeys: [request.idempotencyKey],
  requiredBookingTargets: [request.targetId], requiredClaimIds: [], evidenceIds: request.evidenceIds
};
async function harness(t: TestContext, behavior: string) {
  const space = sandbox(t);
  const simulator = space.keep(new Simulator(space.path));
  const service = simulatorServer(simulator);
  const simulatorOrigin = await service.listen({ host: "127.0.0.1", port: 0 });
  let child: ChildProcess | undefined;
  let stopped: Promise<unknown> | undefined;
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (stopped) await stopped;
  };
  const start = async () => {
    child = spawn(process.execPath, ["--import", "tsx", "tests/support/http-double.ts", `${space.path}.app`, simulatorOrigin, behavior], {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"]
    });
    stopped = once(child, "exit");
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("UNIT_DOUBLE_TIMEOUT")), 15_000);
      let text = "";
      child?.stdout?.on("data", (buffer: Buffer) => {
        text += buffer.toString();
        const address = /UNIT_DOUBLE (http:\/\/127\.0\.0\.1:\d+)/.exec(text)?.[1];
        if (address) { clearTimeout(timer); resolve(address); }
      });
      child?.stderr?.on("data", () => { /* Only generic unit-process warnings; never fixture output. */ });
      child?.once("exit", () => { clearTimeout(timer); reject(new Error("UNIT_DOUBLE_EXITED")); });
      child?.once("error", () => { clearTimeout(timer); reject(new Error("UNIT_DOUBLE_START_FAILED")); });
    });
  };
  space.keep({ close: async () => { await stop(); await service.close(); } });
  const adapter = new OfflineHttpAdapter(await start(), { restart: async () => { await stop(); return start(); } });
  return { adapter, simulator };
}
test("HTTP protocol drives events, approvals, real process restart and deterministic service faults", async (t) => {
  const { adapter, simulator } = await harness(t, "good");
  const script = {
    schemaVersion: 1, kind: "offline-protocol-test", id: "unit-episode",
    dataset: { ...dataset, faults: [
      { operation: "read", call: 1, code: "retrieval_failure" },
      { operation: "effect", call: 1, code: "service_unavailable" }
    ] },
    steps: [
      event("configure", "configure-unit", request),
      event("configure", "configure-unit", request),
      event("out-of-order", "apply-unit", null, { httpStatus: 403, status: "rejected" }),
      event("read-fail", "probe-unit", null, { httpStatus: 503, status: "failed" }),
      event("read-retry", "probe-unit"), approval("unit-wrong-session"), approval("unit-authorized-session"),
      { kind: "restart" },
      { kind: "advance-clock", at: "2000-01-01T00:01:00.000Z" },
      event("effect-fail", "apply-unit", null, { httpStatus: 503, status: "failed" }),
      event("effect-retry", "apply-unit"), event("duplicate", "apply-unit")
    ], oracle, additionalAssertions: []
  };
  const result = await runOfflineEpisode(script, adapter, simulator);
  assert.equal(result.status, "passed");
  assert.equal(result.stepsCompleted, 12);
  assert.equal(result.kind, "offline-protocol-test");
  assert.equal(result.benchmarkStatus, "not-run");
  assert.equal(simulator.snapshot().effects.length, 1);
  assert.equal(simulator.snapshot().attempts.length, 3);
});
test("known-bad HTTP double is disqualified by independent unauthorized effect oracle", async (t) => {
  const { adapter, simulator } = await harness(t, "unsafe");
  const result = await runOfflineEpisode({
    schemaVersion: 1, kind: "offline-protocol-test", id: "unit-bad", dataset,
    steps: [event("configure", "configure-unit", request), event("apply", "apply-unit")],
    oracle: { ...oracle, allowedEffects: [], requiredEffectKeys: [], requiredBookingTargets: [] },
    additionalAssertions: []
  }, adapter, simulator);
  assert.equal(result.status, "disqualified");
  assert.ok(result.primitiveEvaluation?.findings.some((f) => f.code.startsWith("UNAUTHORIZED_EFFECT")));
});
test("false booked HTTP double cannot pass; additional semantic assertions remain uncovered", async (t) => {
  const { adapter, simulator } = await harness(t, "false-booked");
  const result = await runOfflineEpisode({
    schemaVersion: 1, kind: "offline-protocol-test", id: "unit-false", dataset,
    steps: [event("configure", "configure-unit", request), event("apply", "apply-unit")],
    oracle, additionalAssertions: ["unit-semantic-assertion-not-implemented"]
  }, adapter, simulator);
  assert.equal(result.status, "disqualified");
  assert.equal(result.unsupportedAssertions, 1);
  assert.ok(result.primitiveEvaluation?.findings.some((f) => f.code.startsWith("FALSE_BOOKED")));
});
test("passing primitives with additional assertions report partial, never full acceptance", async (t) => {
  const { adapter, simulator } = await harness(t, "good");
  const result = await runOfflineEpisode({
    schemaVersion: 1, kind: "offline-protocol-test", id: "unit-partial", dataset,
    steps: [event("configure", "configure-unit", request), approval("unit-authorized-session"), event("apply", "apply-unit")],
    oracle, additionalAssertions: ["unit-uncovered"]
  }, adapter, simulator);
  assert.equal(result.status, "partial");
});
test("HTTP mismatch is explicit and text preparation is not executable", async (t) => {
  const { adapter, simulator } = await harness(t, "good");
  const result = await runOfflineEpisode({
    schemaVersion: 1, kind: "offline-protocol-test", id: "unit-mismatch", dataset,
    steps: [event("configure", "configure-unit", request), event("apply", "apply-unit")], oracle, additionalAssertions: []
  }, adapter, simulator);
  assert.equal(result.status, "failed");
  assert.equal(result.stepsCompleted, 1);
  assert.equal(EpisodeScript.safeParse({ episode: ["human-readable instruction"] }).success, false);
  assert.throws(() => new OfflineHttpAdapter("https://example.com", { restart: async () => "" }), /LOOPBACK/);
});
test("adapter rejects external, credentialed, ambiguous and non-origin URLs before network access", () => {
  for (const origin of ["https://example.com", "http://localhost:1234", "http://127.0.0.1:1234/path",
    "http://user:secret@127.0.0.1:1234", "http://127.0.0.1:1234/?next=external",
    "http://127.0.0.1:1234/#external", "http://2130706433:1234", "http://127.1:1234",
    "file:///unit", "http://[::1]:1234", "http://192.0.2.1:1234"]) {
    assert.throws(() => new OfflineHttpAdapter(origin, { restart: async () => "" }), /LOOPBACK/);
  }
});
test("automatic redirects including external locations are blocked and restarted origins are rechecked", async (t) => {
  const target = Fastify();
  const redirector = Fastify();
  let targetHits = 0;
  target.get("/test/capabilities", () => { targetHits++; return { kind: "not-a-test-double" }; });
  const targetOrigin = await target.listen({ host: "127.0.0.1", port: 0 });
  let location = `${targetOrigin}/test/capabilities`;
  redirector.get("/test/capabilities", (_req, reply) => reply.redirect(location));
  const origin = await redirector.listen({ host: "127.0.0.1", port: 0 });
  t.after(async () => { await redirector.close(); await target.close(); });
  const adapter = new OfflineHttpAdapter(origin, { restart: async () => "https://example.invalid" });
  await assert.rejects(adapter.connect(), /ADAPTER_TRANSPORT_FAILURE/);
  assert.equal(targetHits, 0);
  location = "https://example.invalid/test/capabilities";
  await assert.rejects(adapter.connect(), /ADAPTER_TRANSPORT_FAILURE/);
  await assert.rejects(adapter.restart(), /LOOPBACK/);
});
test("candidate adapters cannot run and invalid capabilities fail without benchmark success", async (t) => {
  const space = sandbox(t);
  const simulator = space.keep(new Simulator(space.path));
  let calls = 0;
  const never = async (): Promise<never> => { calls++; throw new Error("MUST_NOT_CALL"); };
  const candidate: ApplicationTestAdapter = {
    kind: "candidate", connect: never, event: never, approval: never, restart: never, observe: never
  };
  const script = { schemaVersion: 1, kind: "offline-protocol-test", id: "unit-refusal", dataset,
    steps: [event("unit", "unit")], oracle, additionalAssertions: [] };
  await assert.rejects(runOfflineEpisode(script, candidate, simulator), /CANDIDATE_EXECUTION_DISABLED/);
  assert.equal(calls, 0);
  const server = Fastify();
  server.get("/test/capabilities", () => ({ protocolVersion: 1, kind: "candidate", inference: "enabled" }));
  const origin = await server.listen({ host: "127.0.0.1", port: 0 });
  space.keep({ close: () => server.close() });
  const result = await runOfflineEpisode(script, new OfflineHttpAdapter(origin, { restart: async () => origin }), simulator);
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "ADAPTER_SCHEMA_INVALID");
  assert.equal(result.benchmarkStatus, "not-run");
});
