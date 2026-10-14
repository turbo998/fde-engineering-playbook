import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { TestApprovalCommand, TestEvent } from "../packages/contracts/src/test-adapter.js";
import { Simulator } from "../packages/lab/src/simulator.js";
import {
  OfflineSemanticHttpAdapter, SemanticAction, TypedSemanticEpisode, runOfflineSemanticEpisode,
  type SemanticTestAdapter
} from "../packages/lab/src/semantic-episode.js";
import { digest } from "../packages/lab/src/encoding.js";
import { semanticVector } from "./semantic-helpers.js";
import { sandbox } from "./helpers.js";

export function unitSemanticScript() {
  const v = semanticVector();
  const attempt = v.snapshot.attempts[0]; const handoff = v.observation.handoff; const booking = v.observation.bookings[0];
  assert.ok(attempt && handoff && booking);
  const effectId = "synthetic-effect-1";
  handoff.context.effectId = effectId; booking.effectId = effectId;
  v.observation.attemptAudit = [{ ...structuredClone(attempt), effectId }];
  const script = TypedSemanticEpisode.parse({
    schemaVersion: 3, kind: "private-typed-semantic-preparation", executionStatus: "not-run", id: "unit-typed",
    dataset: { clock: v.oracle.at, policyVersion: v.oracle.policyVersion, fixtures: v.oracle.fixtures, faults: [] },
    steps: [
      { kind: "trusted-control", eventKind: "decision", trustedSequence: 2 },
      { kind: "approval", command: {
        id: "unit-command", tenantId: v.oracle.tenantId, caseId: v.oracle.caseId,
        approvalId: "unit-approval", decision: "approved", planVersion: "unit-plan"
      }, sessionRef: "unit-session", expected: { httpStatus: 200, status: "accepted" } },
      { kind: "action", id: "unit-execute", action: { kind: "execute-effect", request: attempt.request },
        expected: { httpStatus: 200, status: "accepted" } },
      { kind: "restart" }, { kind: "observe", expected: v.observation }
    ],
    oracle: v.oracle, sourceStepMappings: [{
      sourceIndex: 0, sourceDigest: digest("UNIT_SEMANTIC_CANARY; process.exit(99) -- inert prose"),
      typedStepIndices: [0, 1, 2, 3, 4], rationale: "Hand-authored protocol unit steps; source prose is never interpreted."
    }]
  });
  return { script, observation: v.observation };
}

test("semantic HTTP episode observes independent service effects and retains disabled benchmark status", async (t) => {
  const space = sandbox(t);
  const sim = space.keep(new Simulator(space.path));
  const { script, observation } = unitSemanticScript();
  const app = Fastify({ logger: false });
  let restarts = 0;
  app.get("/test/capabilities", () => ({ protocolVersion: 1, kind: "offline-test-double", inference: "disabled" }));
  app.post("/test/events", (req) => {
    const event = TestEvent.parse(req.body);
    const action = SemanticAction.parse(event.body);
    assert.equal(event.type, action.kind);
    if (action.kind !== "execute-effect") throw new Error("UNIT_ACTION_UNEXPECTED");
    sim.attempt(action.request);
    return { id: event.id, status: "accepted" };
  });
  app.post("/test/approvals", (req) => {
    assert.equal(req.headers["x-synthetic-session"], "unit-session");
    return { id: "unit-command", status: "accepted" };
  });
  app.get("/test/semantic-observation", () => observation);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  space.keep({ close: () => app.close() });
  const adapter = new OfflineSemanticHttpAdapter(origin, { restart: async () => { restarts++; return origin; } });
  const result = await runOfflineSemanticEpisode(script, adapter, sim);
  assert.equal(result.evaluation.status, "passed");
  assert.equal(result.stepsCompleted, 5);
  assert.equal(result.benchmarkStatus, "not-run");
  assert.equal(sim.snapshot().effects.length, 1);
  assert.equal(restarts, 1);
});
test("semantic candidate gate refuses before connect or simulator reset; scripts cannot eval prose", async (t) => {
  const space = sandbox(t); const sim = space.keep(new Simulator(space.path));
  const { script } = unitSemanticScript(); sim.reset(script.dataset);
  let calls = 0;
  const never = async (): Promise<never> => { calls++; throw new Error("UNIT_MUST_NOT_CALL"); };
  const adapter: SemanticTestAdapter = {
    kind: "candidate", connect: never, event: never, approval: never, restart: never, observe: never, observeSemantic: never
  };
  const before = sim.snapshot();
  await assert.rejects(runOfflineSemanticEpisode(script, adapter, sim), /CANDIDATE_EXECUTION_DISABLED/);
  assert.equal(calls, 0); assert.deepEqual(sim.snapshot(), before);
  assert.equal(TypedSemanticEpisode.safeParse({ ...script, steps: ["process.exit(99)"] }).success, false);
});
test("semantic checkpoints and reply mismatch fail explicitly, without fallback result", async (t) => {
  const space = sandbox(t); const sim = space.keep(new Simulator(space.path));
  const { script, observation } = unitSemanticScript();
  const adapter: SemanticTestAdapter = {
    kind: "offline-test-double", connect: async () => {}, restart: async () => {},
    event: async (event) => ({ httpStatus: 200, acknowledgement: { id: event.id, status: "accepted" } }),
    approval: async (command) => ({ httpStatus: 200, acknowledgement: { id: command.id, status: "accepted" } }),
    observe: async () => ({ tenantId: script.oracle.tenantId, caseId: script.oracle.caseId,
      status: "completed", bookings: [], claims: [] }),
    observeSemantic: async () => ({ ...observation, status: "failed" })
  };
  await assert.rejects(runOfflineSemanticEpisode(script, adapter, sim), /SEMANTIC_CHECKPOINT_MISMATCH/);
  adapter.approval = async (command) => ({
    httpStatus: 403, acknowledgement: { id: command.id, status: "rejected" }
  });
  await assert.rejects(runOfflineSemanticEpisode(script, adapter, sim), /SEMANTIC_STEP_REPLY_MISMATCH/);
});
test("typed mappings reject omitted source steps, uncovered actions, wrong digests and untrusted sessions", () => {
  const { script } = unitSemanticScript();
  const invalid = structuredClone(script);
  assert.ok(invalid.sourceStepMappings[0]);
  invalid.sourceStepMappings[0].typedStepIndices.pop();
  assert.equal(TypedSemanticEpisode.safeParse(invalid).success, false);
  const session = structuredClone(script); const first = session.steps[1]; assert.ok(first?.kind === "approval");
  first.sessionRef = "unit-forged";
  assert.equal(TypedSemanticEpisode.safeParse(session).success, false);
  const reference = structuredClone(script); const control = reference.steps[0]; assert.ok(control?.kind === "trusted-control");
  control.trustedSequence = 999;
  assert.equal(TypedSemanticEpisode.safeParse(reference).success, false);
});
test("same-clock execute-before-grant never receives semantic passed", async (t) => {
  const space = sandbox(t); const sim = space.keep(new Simulator(space.path));
  const { script, observation } = unitSemanticScript();
  const [control, approval, execute, restart] = script.steps;
  assert.ok(control?.kind === "trusted-control" && approval?.kind === "approval" &&
    execute?.kind === "action" && restart?.kind === "restart");
  script.steps = [execute, control, approval, restart];
  assert.ok(script.sourceStepMappings[0]); script.sourceStepMappings[0].typedStepIndices = [0, 1, 2, 3];
  const delivered: string[] = [];
  const app = Fastify({ logger: false });
  app.get("/test/capabilities", () => ({ protocolVersion: 1, kind: "offline-test-double", inference: "disabled" }));
  app.post("/test/events", (req) => {
    const event = TestEvent.parse(req.body); const action = SemanticAction.parse(event.body);
    assert.ok(action.kind === "execute-effect");
    sim.attempt(action.request); delivered.push("execute");
    observation.attemptAudit = sim.snapshot().attempts;
    return { id: event.id, status: "accepted" };
  });
  app.post("/test/approvals", () => {
    delivered.push("grant");
    return { id: approval.command.id, status: "accepted" };
  });
  app.get("/test/semantic-observation", () => observation);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  space.keep({ close: () => app.close() });
  const result = await runOfflineSemanticEpisode(script,
    new OfflineSemanticHttpAdapter(origin, { restart: async () => origin }), sim);
  assert.deepEqual(delivered, ["execute", "grant"]);
  assert.equal(sim.snapshot().attempts[0]?.at, script.oracle.decisions[0]?.at);
  assert.equal(result.evaluation.status, "disqualified");
});
const orderedEpisodes = [
  { name: "cancellation after confirmation", order: ["grant", "execute", "cancel"], status: "passed" },
  { name: "cancellation before confirmation", order: ["grant", "cancel", "execute"], status: "disqualified" },
  { name: "retry before cancellation", order: ["grant", "execute", "retry", "cancel"], status: "passed" },
  { name: "retry after cancellation", order: ["grant", "execute", "cancel", "retry"], status: "disqualified" },
  { name: "replayed grant cannot resurrect cancelled authority",
    order: ["grant", "execute", "cancel", "replay-control", "retry"], status: "disqualified" },
  { name: "retry across adapter restart callback", order: ["grant", "execute", "restart", "retry"], status: "passed" },
  { name: "manual evidence before approval", order: ["manual", "grant", "execute"], status: "passed", manual: true },
  { name: "manual evidence after approval", order: ["grant", "manual", "execute"], status: "disqualified", manual: true }
] as const;
for (const scenario of orderedEpisodes) {
  test(`actual same-clock ordering: ${scenario.name}`, async (t) => {
    const space = sandbox(t); const sim = space.keep(new Simulator(space.path));
    const { script, observation } = unitSemanticScript();
    const [grantControl, approval, execute] = script.steps;
    const decision = script.oracle.decisions[0]; const plan = script.oracle.plans[0];
    assert.ok(grantControl?.kind === "trusted-control" && approval?.kind === "approval" &&
      execute?.kind === "action" && decision && plan);
    const cancelled = { ...structuredClone(decision), sequence: 1,
      record: { ...structuredClone(decision.record), status: "cancelled" as const } };
    if (scenario.order.some((name) => name === "cancel")) script.oracle.decisions.push(cancelled);
    if ("manual" in scenario) {
      plan.path = "B"; decision.record.manualVerificationEventId = "unit-manual";
      script.oracle.manualEvents = [{
        id: "unit-manual", sequence: 1, at: script.oracle.at, sessionRef: decision.sessionRef,
        tenantId: plan.tenantId, caseId: plan.caseId, planVersion: plan.version,
        policyVersion: plan.policyVersion, factsDigest: plan.factsDigest, evidence: plan.evidence
      }];
      script.oracle.requiredRules.push("manual-ordering");
    }
    script.steps = [];
    for (const name of scenario.order) {
      if (name === "grant") script.steps.push(grantControl, approval);
      if (name === "execute" || name === "retry") script.steps.push(execute);
      if (name === "replay-control") script.steps.push(grantControl);
      if (name === "cancel") script.steps.push(
        { kind: "trusted-control", eventKind: "decision", trustedSequence: cancelled.sequence },
        { ...approval, command: { ...approval.command, id: "unit-cancel", decision: "cancelled" } });
      if (name === "manual") script.steps.push(
        { kind: "trusted-control", eventKind: "manual", trustedSequence: 1 },
        { kind: "action", id: "unit-manual-action",
          action: { kind: "manual-verification", eventId: "unit-manual", sessionRef: decision.sessionRef, plan },
          expected: { httpStatus: 200, status: "accepted" } });
      if (name === "restart") script.steps.push({ kind: "restart" });
    }
    assert.ok(script.sourceStepMappings[0]);
    script.sourceStepMappings[0].typedStepIndices = script.steps.map((_step, i) => i);
    observation.approvalHistory = [];
    const delivered: string[] = [];
    const app = Fastify({ logger: false });
    app.get("/test/capabilities", () => ({ protocolVersion: 1, kind: "offline-test-double", inference: "disabled" }));
    app.post("/test/events", (req) => {
      const event = TestEvent.parse(req.body); const action = SemanticAction.parse(event.body);
      if (action.kind === "execute-effect") {
        const attempt = sim.attempt(action.request); delivered.push(attempt.outcome === "duplicate" ? "retry" : "execute");
      } else {
        assert.equal(action.kind, "manual-verification"); delivered.push("manual");
      }
      return { id: event.id, status: "accepted" };
    });
    app.post("/test/approvals", (req) => {
      const command = TestApprovalCommand.parse(req.body);
      const trusted = command.decision === "cancelled" ? cancelled : decision;
      assert.ok(observation.approvalHistory);
      observation.approvalHistory.push({ sequence: trusted.sequence, record: structuredClone(trusted.record) });
      delivered.push(command.decision === "cancelled" ? "cancel" : "grant");
      return { id: command.id, status: "accepted" };
    });
    app.get("/test/semantic-observation", () => {
      observation.attemptAudit = sim.snapshot().attempts;
      assert.ok(observation.recovery); observation.recovery.effectAttempts = observation.attemptAudit.length;
      return observation;
    });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    space.keep({ close: () => app.close() });
    const result = await runOfflineSemanticEpisode(script, new OfflineSemanticHttpAdapter(origin, {
      restart: async () => { delivered.push("restart"); return origin; }
    }), sim);
    assert.deepEqual(delivered, scenario.order.filter((name) => name !== "replay-control"));
    assert.equal(result.evaluation.status, scenario.status, JSON.stringify(result.evaluation));
    assert.equal(sim.snapshot().effects.length, 1);
    assert.ok(sim.snapshot().causalEvents?.every((e) => e.at === script.oracle.at));
    if (scenario.order.some((name) => name === "cancel") && scenario.order[1] === "execute") {
      for (const rule of ["confirmation", "handoff"]) {
        assert.equal(result.evaluation.rules.find((r) => r.rule === rule)?.disposition, "passed");
      }
    }
  });
}
