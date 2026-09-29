import Fastify from "fastify";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { EffectRequest } from "../../packages/contracts/src/index.js";
import { TestApprovalCommand, TestEvent } from "../../packages/contracts/src/test-adapter.js";

// A generic protocol test double, not a travel application or a measured coding arm.
const [database, simulatorOrigin, behavior] = process.argv.slice(2);
if (!database || !simulatorOrigin || !["good", "unsafe", "false-booked"].includes(behavior ?? "")) {
  throw new Error("UNIT_DOUBLE_ARGUMENTS");
}
const origin = new URL(simulatorOrigin);
if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/?$/.test(simulatorOrigin) ||
    origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") throw new Error("UNIT_DOUBLE_LOOPBACK_ONLY");
const db = new DatabaseSync(database);
db.exec("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
const State = z.strictObject({
  effect: EffectRequest.nullable(), approved: z.boolean(),
  status: z.enum(["running", "awaiting_approval", "completed", "failed"]),
  effectId: z.string().nullable()
});
db.prepare("INSERT OR IGNORE INTO state VALUES(1, ?)").run(JSON.stringify({
  effect: null, approved: false, status: "running", effectId: null
}));
const load = () => State.parse(JSON.parse(z.string().parse(db.prepare("SELECT body FROM state WHERE id=1").get()?.body)));
const save = (state: z.infer<typeof State>) => db.prepare("UPDATE state SET body=? WHERE id=1").run(JSON.stringify(state));
const app = Fastify({ logger: false });
app.get("/test/capabilities", async () => ({ protocolVersion: 1, kind: "offline-test-double", inference: "disabled" }));
app.post("/test/events", async (req, reply) => {
  const event = TestEvent.parse(req.body);
  const state = load();
  if (event.type === "configure-unit") {
    state.effect = EffectRequest.parse(event.body);
    state.status = "awaiting_approval";
    save(state);
  } else if (event.type === "probe-unit") {
    const result = await fetch(new URL(`/resources/${event.tenantId}/hotel`, origin), {
      redirect: "error", signal: AbortSignal.timeout(3000)
    });
    if (result.status === 503) {
      state.status = "failed";
      save(state);
      return reply.code(503).send({ id: event.id, status: "failed" });
    }
    if (!result.ok) throw new Error("UNIT_SIMULATOR_READ_FAILED");
  } else if (event.type === "apply-unit") {
    if (!state.effect || (!state.approved && behavior === "good")) {
      return reply.code(403).send({ id: event.id, status: "rejected" });
    }
    if (behavior === "false-booked") state.effectId = "unit-fabricated-effect";
    else {
      const result = await fetch(new URL("/effects", origin), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(state.effect), redirect: "error", signal: AbortSignal.timeout(3000)
      });
      if (result.status === 503) return reply.code(503).send({ id: event.id, status: "failed" });
      if (!result.ok) throw new Error("UNIT_SIMULATOR_EFFECT_FAILED");
      state.effectId = z.object({ effectId: z.string() }).parse(await result.json()).effectId;
    }
    state.status = "completed";
    save(state);
  } else throw new Error("UNIT_UNKNOWN_EVENT");
  return { id: event.id, status: "accepted" };
});
app.post("/test/approvals", async (req, reply) => {
  const command = TestApprovalCommand.parse(req.body);
  const state = load();
  if (req.headers["x-synthetic-session"] !== "unit-authorized-session" ||
      !state.effect || command.tenantId !== state.effect.tenantId ||
      command.caseId !== state.effect.caseId || command.planVersion !== state.effect.planVersion) {
    return reply.code(403).send({ id: command.id, status: "rejected" });
  }
  state.approved = command.decision === "approved";
  save(state);
  return { id: command.id, status: "accepted" };
});
app.get("/test/observation", async () => {
  const state = load();
  if (!state.effect) throw new Error("UNIT_NOT_CONFIGURED");
  return {
    tenantId: state.effect.tenantId, caseId: state.effect.caseId, status: state.status,
    bookings: state.effectId ? [{
      targetId: state.effect.targetId, effectId: state.effectId, evidenceIds: state.effect.evidenceIds
    }] : [], claims: []
  };
});
app.addHook("onClose", async () => { db.close(); });
process.once("SIGTERM", () => { void app.close(); });
console.log(`UNIT_DOUBLE ${await app.listen({ host: "127.0.0.1", port: 0 })}`);
