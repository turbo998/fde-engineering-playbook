import Fastify from "fastify";
import { z } from "zod";
import { EffectRequest, Id } from "../../contracts/src/index.js";
import type { Simulator } from "./simulator.js";

const ReadParams = z.strictObject({
  tenant: Id,
  kind: z.enum(["evidence", "hotel", "arrival", "contract", "supplier_event", "experience"])
});

export function simulatorServer(simulator: Simulator) {
  const app = Fastify({ logger: false });
  app.get("/resources/:tenant/:kind", async (request, reply) => {
    const parsed = ReadParams.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_RESOURCE_QUERY" });
    const result = simulator.read(parsed.data.tenant, parsed.data.kind);
    return reply.code(result.status === "fault" ? 503 : 200).send(result);
  });
  app.post("/effects", async (request, reply) => {
    const parsed = EffectRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_EFFECT_REQUEST" });
    const result = simulator.attempt(parsed.data);
    const status = result.outcome === "fault" ? 503 : result.outcome === "conflict" ? 409 : 200;
    return reply.code(status).send(result);
  });
  return app;
}
