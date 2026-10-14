import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { TestEvent } from "../packages/contracts/src/test-adapter.js";
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
    schemaVersion: 2, kind: "private-typed-semantic-preparation", executionStatus: "not-run", id: "unit-typed",
    dataset: { clock: v.oracle.at, policyVersion: v.oracle.policyVersion, fixtures: v.oracle.fixtures, faults: [] },
    steps: [
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
      typedStepIndices: [0, 1, 2, 3], rationale: "Hand-authored protocol unit steps; source prose is never interpreted."
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
  assert.equal(result.stepsCompleted, 4);
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
  const session = structuredClone(script); const first = session.steps[0]; assert.ok(first?.kind === "approval");
  first.sessionRef = "unit-forged";
  assert.equal(TypedSemanticEpisode.safeParse(session).success, false);
});
