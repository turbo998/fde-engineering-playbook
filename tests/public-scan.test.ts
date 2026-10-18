import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sandbox } from "./helpers.js";

test("publication scanner preserves exact main maintenance files but rejects arbitrary GitHub artifacts", (t) => {
  const cwd = dirname(sandbox(t).path);
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd }).status, 0);
  mkdirSync(join(cwd, ".github"));
  for (const name of ["CONTRIBUTING.md", "SECURITY.md", "dependabot.yml"]) {
    writeFileSync(join(cwd, ".github", name), "Synthetic public maintenance fixture\n");
  }
  const args = ["--import", "tsx", resolve("scripts", "check-public.ts")];
  const pass = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /PASS: 3 allowlisted/);
  writeFileSync(join(cwd, ".github", "unapproved.json"), "{}");
  const fail = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /Not in publication allowlist/);
});
