import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { DatabaseSync } from "node:sqlite";
import { SeedStatus } from "../../../packages/contracts/src/index.js";

export async function buildServer(options: { database: string; webRoot?: string }) {
  const db = new DatabaseSync(options.database);
  db.exec("CREATE TABLE IF NOT EXISTS seed_meta (id INTEGER PRIMARY KEY CHECK(id=1), boots INTEGER NOT NULL)");
  db.exec("INSERT INTO seed_meta VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET boots = boots + 1");
  const row = db.prepare("SELECT boots FROM seed_meta WHERE id=1").get();
  const status = SeedStatus.parse({
    schemaVersion: 1, kind: "neutral-seed", benchmarkStatus: "not-run",
    inference: "disabled", businessImplementation: false, storage: "sqlite", bootCount: row?.boots
  });
  const app = Fastify({ logger: false });
  app.addHook("onClose", async () => { db.close(); });
  app.get("/api/health", async () => ({ ok: true, scope: "offline-seed-only" }));
  app.get("/api/status", async () => status);
  app.post("/api/inference", async (_request, reply) =>
    reply.code(403).send({ error: "LIVE_DISABLED", benchmarkStatus: "not-run" }));
  if (options.webRoot) {
    await app.register(fastifyStatic, { root: options.webRoot });
  }
  return app;
}
