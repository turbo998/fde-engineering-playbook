import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { exportSeed, seedSourceFiles, verifySeed } from "../packages/lab/src/seed-export.js";
import { sandbox } from "./helpers.js";

function source(t: Parameters<typeof sandbox>[0]) {
  const root = dirname(sandbox(t).path);
  const sourceRoot = join(root, "source");
  mkdirSync(sourceRoot);
  for (const file of [...seedSourceFiles, "package.json", "package-lock.json"]) {
    const destination = join(sourceRoot, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(file), destination);
  }
  return { root, sourceRoot, destination: join(root, "export") };
}
test("seed exact allowlist excludes synthetic method, research, history, logs, dependencies and candidate canaries", (t) => {
  const { sourceRoot, destination } = source(t);
  for (const file of [".git/config", ".github/skills/method.md", ".local/transcript.json",
    "node_modules/foreign/index.js", "docs/research.md", "packages/lab/canary.ts",
    "apps/candidate/canary.ts", "AGENTS.md", "output.log"]) {
    const path = join(sourceRoot, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "EXCLUDED_SYNTHETIC_CANARY");
  }
  const receipt = exportSeed(sourceRoot, destination);
  assert.deepEqual(verifySeed(destination, receipt.manifestHash), {
    fileCount: seedSourceFiles.length + 4, manifestHash: receipt.manifestHash
  });
  const manifest = readFileSync(join(destination, "seed-manifest.json"), "utf8");
  assert.ok(!manifest.includes(sourceRoot));
  assert.ok(!readFileSync(join(destination, "package-lock.json"), "utf8").includes("copilot"));
  assert.ok(!readFileSync(join(destination, "package-lock.json"), "utf8").includes("packages/lab"));
  for (const file of [...seedSourceFiles, "package.json", "package-lock.json", "README.md", ".gitignore"]) {
    assert.ok(!readFileSync(join(destination, file), "utf8").includes("EXCLUDED_SYNTHETIC_CANARY"));
  }
  assert.throws(() => exportSeed(sourceRoot, destination), /EEXIST/);
});
test("seed verification rejects content changes, forged receipt and extra files or empty directories", (t) => {
  const { sourceRoot, destination, root } = source(t);
  const receipt = exportSeed(sourceRoot, destination);
  assert.throws(() => verifySeed(destination, "0".repeat(64)), /MANIFEST_HASH/);
  writeFileSync(join(destination, "README.md"), "changed");
  assert.throws(() => verifySeed(destination, receipt.manifestHash), /FILE_HASH/);
  for (const mode of ["file", "directory", "manifest"]) {
    const dir = join(root, mode);
    const value = exportSeed(sourceRoot, dir);
    if (mode === "file") writeFileSync(join(dir, "AGENTS.md"), "SYNTHETIC_METHOD_CANARY");
    else if (mode === "directory") mkdirSync(join(dir, ".git"));
    else writeFileSync(join(dir, "seed-manifest.json"), "{}");
    assert.throws(() => verifySeed(dir, value.manifestHash));
  }
});
test("seed refuses traversal and source, destination-parent and exported directory junction/symlink escapes", (t) => {
  const { sourceRoot, root, destination } = source(t);
  assert.throws(() => exportSeed(sourceRoot, `${root}${process.platform === "win32" ? "\\" : "/"}..${process.platform === "win32" ? "\\" : "/"}escape`), /PATH_REJECTED/);
  const escaped = join(root, "elsewhere");
  mkdirSync(escaped);
  const link = join(root, "parent-link");
  symlinkSync(escaped, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => exportSeed(sourceRoot, join(link, "export")), /LINK_REJECTED/);
  const receipt = exportSeed(sourceRoot, destination);
  symlinkSync(escaped, join(destination, "escape"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => verifySeed(destination, receipt.manifestHash), /LINK_REJECTED/);
  const sourceDirectory = join(sourceRoot, "apps", "seed", "src");
  const moved = join(root, "moved-source");
  renameSync(sourceDirectory, moved);
  symlinkSync(moved, sourceDirectory, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => exportSeed(sourceRoot, join(root, "refused")), /LINK_REJECTED/);
});
