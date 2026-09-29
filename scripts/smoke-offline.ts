import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { SeedStatus } from "../packages/contracts/src/index.js";

const child = spawn(process.execPath, ["dist/apps/seed/src/main.js"], {
  cwd: process.cwd(), env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
const exited = once(child, "exit");
try {
  const address = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error("Seed startup timed out")); }, 15_000);
    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      const match = /Neutral seed only: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match?.[1]) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Seed exited (${code}): ${stderr}`)); });
  });
  const get = (path: string, method = "GET") => fetch(`${address}${path}`, { method, signal: AbortSignal.timeout(5000) });
  const status: unknown = await (await get("/api/status")).json();
  assert.equal(SeedStatus.parse(status).inference, "disabled");
  assert.equal((await get("/api/inference", "POST")).status, 403);
  assert.equal((await get("/api/approvals", "POST")).status, 404);
  const html = await (await get("/")).text();
  assert.match(html, /FDE 离线实验底座/);
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
  assert.ok(asset);
  assert.ok(asset.startsWith("/assets/"));
  assert.equal((await get(asset)).status, 200);
  console.log("PASS: built React assets + real loopback Fastify + SQLite; inference refused; no business implementation");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await exited;
}
