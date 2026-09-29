import test from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../apps/seed/src/server.js";
import { SeedStatus } from "../packages/contracts/src/index.js";
import { sandbox } from "./helpers.js";

test("neutral API exposes only honest infrastructure state", async (t) => {
  const space = sandbox(t);
  const app = await buildServer({ database: space.path });
  try {
    assert.equal((await app.inject("/api/health")).statusCode, 200);
    const status = SeedStatus.parse((await app.inject("/api/status")).json());
    assert.equal(status.businessImplementation, false);
    assert.equal(status.benchmarkStatus, "not-run");
    assert.equal((await app.inject({ method: "POST", url: "/api/inference" })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/approvals" })).statusCode, 404);
  } finally { await app.close(); }
});
test("SQLite persists neutral seed metadata across application restart", async (t) => {
  const space = sandbox(t);
  const first = await buildServer({ database: space.path });
  const before = SeedStatus.parse((await first.inject("/api/status")).json());
  await first.close();
  const second = await buildServer({ database: space.path });
  try {
    const after = SeedStatus.parse((await second.inject("/api/status")).json());
    assert.equal(after.bootCount, before.bootCount + 1);
  } finally { await second.close(); }
});
