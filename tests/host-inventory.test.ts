import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HostInventoryReceipt, HostInventoryTarget, runHostInventory, type InventoryProcess } from "../packages/lab/src/host-inventory.js";
import { sandbox } from "./helpers.js";
import type { TestContext } from "node:test";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const nodeHash = sha256(readFileSync(process.execPath));
function target(t: TestContext, fixtureMode = "positive") {
  const space = sandbox(t); const directory = dirname(space.path);
  const entry = join(directory, "index.js"); const packagePath = join(directory, "package.json");
  const cliMain = join(directory, "cli-main.js");
  const runtimeDir = join(directory, "prebuilds", `${process.platform}-${process.arch}`);
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(entry, readFileSync(resolve("tests", "support", "inventory-host.mjs")));
  writeFileSync(packagePath, JSON.stringify({ name: "@github/copilot", version: "1.0.95-3", fixtureMode }));
  writeFileSync(cliMain, "Synthetic identity fixture, not a CLI runtime.\n");
  writeFileSync(join(runtimeDir, "runtime.node"), "Synthetic identity fixture; never loaded.\n");
  return HostInventoryTarget.parse({
    nodePath: process.execPath, entryPath: entry, packageDirectory: directory, expectedVersion: "1.0.95-3",
    sha256: {
      node: nodeHash, entry: sha256(readFileSync(entry)), package: sha256(readFileSync(packagePath)),
      cliMain: sha256(readFileSync(cliMain)), runtime: sha256(readFileSync(join(runtimeDir, "runtime.node")))
    }
  });
}
function assertOwnedCleanup(pinned: ReturnType<typeof target>) {
  const trace = join(pinned.packageDirectory, "observed-cwd.txt");
  if (existsSync(trace)) {
    const fixture = dirname(readFileSync(trace, "utf8"));
    assert.ok(fixture.startsWith(resolve(".local", "host-inventory-")));
    assert.equal(existsSync(fixture), false);
  }
}
test("real offline CLI double observes inherited skills, exclusive baseline/treatment and sanitized receipt", (t) => {
  const pinned = target(t);
  const receipt = runHostInventory(pinned);
  assert.deepEqual(receipt.errorCodes, []); assert.equal(receipt.status, "observed");
  assert.equal(receipt.cleanup, "removed"); assertOwnedCleanup(pinned);
  assert.equal(receipt.baselineEnabledCount, 2); assert.equal(receipt.baselineEnabledNonbuiltinCount, 0);
  assert.equal(receipt.treatmentEnabledCount, 3); assert.equal(receipt.treatmentEnabledNonbuiltinCount, 1);
  assert.equal(receipt.inventoryExclusivity, "verified");
  const inherited = receipt.probes.find((p) => p.phase === "clean" && p.kind === "skill");
  assert.equal(inherited?.sourceCounts?.inherited, 1);
  const noInstructions = receipt.probes.find((p) => p.phase === "no-custom-instructions" && p.kind === "skill");
  assert.equal(noInstructions?.enabledNonbuiltinCount, 2);
  assert.equal(receipt.probes.find((p) => p.kind === "instruction")?.enabledCount, null);
  assert.equal(receipt.probes.find((p) => p.kind === "plugin")?.totalCount, 0);
  assert.equal(receipt.probes.find((p) => p.kind === "mcp")?.configuredMcpServers, 0);
  assert.equal(receipt.nativePlatformSupport, null); assert.equal(receipt.modelRequests, 0);
  for (const field of ["activationVerified", "osIsolationVerified", "crossArmIsolationVerified",
    "holdoutIsolationVerified", "hostProjectedInstructionsVerified", "hooksAndMemoryVerified", "methodLoadingVerified"] as const) {
    assert.equal(receipt[field], false);
  }
  const serialized = JSON.stringify(receipt);
  for (const secret of [pinned.entryPath, pinned.packageDirectory, process.execPath, "PRIVATE_CANARY",
    "unit-inherited", "unit-builtin-a", "fde-personal-canary", "fde-method-canary"]) assert.ok(!serialized.includes(secret));
  assert.equal(HostInventoryReceipt.safeParse(JSON.parse(serialized)).success, true);
});
for (const [mode, code] of [
  ["malformed", "INVENTORY_JSON_INVALID"], ["unknown-shape", "INVENTORY_SHAPE_UNSUPPORTED"],
  ["unknown-source", "INVENTORY_SHAPE_UNSUPPORTED"], ["missing-enabled", "INVENTORY_SHAPE_UNSUPPORTED"],
  ["duplicate-names", "INVENTORY_SHAPE_UNSUPPORTED"], ["unknown-plugin", "INVENTORY_SHAPE_UNSUPPORTED"],
  ["unknown-mcp", "INVENTORY_SHAPE_UNSUPPORTED"], ["process-failure", "CLI_PROCESS_FAILED"],
  ["unknown-instruction", "INVENTORY_SHAPE_UNSUPPORTED"],
  ["wrong-version", "CLI_VERSION_MISMATCH"], ["output-limit", "CLI_OUTPUT_LIMIT"],
  ["ineffective-disable", "CANARY_DISABLE_INEFFECTIVE"],
  ["baseline-disable-ineffective", "BASELINE_NOT_EXCLUSIVE"],
  ["unexpected-treatment", "TREATMENT_NOT_EXCLUSIVE"], ["wrong-treatment-path", "TREATMENT_NOT_EXCLUSIVE"],
  ["missing-builtin", "TREATMENT_NOT_EXCLUSIVE"]
] as const) {
  test(`inventory ${mode} is explicit and cannot certify exclusivity`, (t) => {
    const pinned = target(t, mode);
    const receipt = runHostInventory(pinned);
    assert.deepEqual(receipt.errorCodes, [code]);
    assert.notEqual(receipt.status, "observed"); assert.notEqual(receipt.inventoryExclusivity, "verified");
    assert.equal(receipt.cleanup, "removed"); assertOwnedCleanup(pinned);
    assert.ok(!JSON.stringify(receipt).includes("PRIVATE_CANARY")); assert.equal(receipt.modelRequests, 0);
    if (mode === "unknown-mcp") assert.equal(receipt.probes.at(-1)?.configuredMcpServers, null);
    if (mode === "malformed" || mode === "unknown-shape") assert.equal(receipt.probes.at(-1)?.totalCount, null);
  });
}
test("actual process timeout kills the offline double and removes its disposable fixtures", (t) => {
  const pinned = target(t, "timeout");
  const receipt = runHostInventory(pinned, { timeoutMs: 100 });
  assert.deepEqual(receipt.errorCodes, ["CLI_PROCESS_TIMEOUT"]);
  assert.equal(receipt.cleanup, "removed"); assertOwnedCleanup(pinned);
  assert.equal(receipt.baselineEnabledCount, null); assert.equal(receipt.inventoryExclusivity, "unavailable");
});
test("overall deadline rejects before another process starts, without guessing empty inventories", (t) => {
  const pinned = target(t); let ticks = 0; let calls = 0;
  t.mock.method(Date, "now", () => ticks++ === 0 ? 0 : 90_001);
  const receipt = runHostInventory(pinned, { process: () => {
    calls++; throw new Error("PRIVATE_CANARY");
  } });
  assert.deepEqual(receipt.errorCodes, ["CLI_PROCESS_TIMEOUT"]); assert.equal(calls, 0);
  assert.equal(receipt.baselineEnabledCount, null); assert.equal(receipt.cleanup, "removed");
});
test("wrong identity/version or invalid targets fail before any CLI/configuration operation", (t) => {
  const pinned = target(t);
  let calls = 0;
  const never: InventoryProcess = () => { calls++; throw new Error("PRIVATE_CANARY"); };
  for (const key of ["node", "entry", "package", "cliMain", "runtime"] as const) {
    const incorrect = structuredClone(pinned); incorrect.sha256[key] = "0".repeat(64);
    const receipt = runHostInventory(incorrect, { process: never });
    assert.deepEqual(receipt.errorCodes, ["HOST_IDENTITY_MISMATCH"]); assert.equal(receipt.cleanup, "not-created");
  }
  const wrongNode = { ...pinned, nodePath: pinned.entryPath };
  assert.deepEqual(runHostInventory(wrongNode, { process: never }).errorCodes, ["HOST_IDENTITY_MISMATCH"]);
  assert.deepEqual(runHostInventory({ ...pinned, expectedVersion: "unapproved" }, { process: never }).errorCodes, ["TARGET_INVALID"]);
  assert.deepEqual(runHostInventory(pinned, { process: never, timeoutMs: 0 }).errorCodes, ["TARGET_INVALID"]);
  const manifest = join(pinned.packageDirectory, "package.json");
  writeFileSync(manifest, JSON.stringify({ name: "@github/copilot", version: "1.0.72-1" }));
  const receipt = runHostInventory(pinned, { process: never });
  assert.deepEqual(receipt.errorCodes, ["HOST_VERSION_UNSUPPORTED"]); assert.equal(receipt.identity, null);
  assert.equal(calls, 0);
});
test("child environment and command surface are allowlisted and never create a model session", (t) => {
  const pinned = target(t);
  const allowed = new Set(["SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "PROGRAMFILES",
    "PROGRAMFILES(X86)", "PROGRAMDATA", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "HOME", "USERPROFILE",
    "COPILOT_HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
    "COPILOT_ALLOW_ALL", "COPILOT_OFFLINE", "NO_COLOR"]);
  const receipt = runHostInventory(pinned, { process: (invocation) => {
    assert.ok(Object.keys(invocation.env).every((key) => allowed.has(key.toUpperCase())));
    assert.equal(invocation.env.COPILOT_OFFLINE, "true"); assert.equal(invocation.env.COPILOT_ALLOW_ALL, "false");
    for (const key of ["HOME", "USERPROFILE", "COPILOT_HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
      "XDG_CONFIG_HOME", "XDG_CACHE_HOME"] as const) assert.ok(invocation.env[key]?.startsWith(dirname(invocation.cwd)));
    assert.equal(invocation.executable, process.execPath);
    assert.deepEqual(invocation.args.slice(1, 5), ["--no-auto-update", "--no-remote", "--no-remote-export", "--disable-builtin-mcps"]);
    assert.deepEqual(invocation.args.slice(5), ["--version"]);
    assert.ok(invocation.timeoutMs <= 30_000); assert.equal(invocation.maxOutputBytes, 1024 * 1024);
    return { status: 1, stdout: "PRIVATE_CANARY", failure: null };
  } });
  assert.deepEqual(receipt.errorCodes, ["CLI_PROCESS_FAILED"]); assert.equal(receipt.cleanup, "removed");
});
test("unexpected process errors never leak details and still clean up", (t) => {
  const pinned = target(t);
  const receipt = runHostInventory(pinned, { process: () => { throw new Error(`PRIVATE_CANARY ${pinned.entryPath}`); } });
  assert.deepEqual(receipt.errorCodes, ["HOST_DIAGNOSTIC_UNEXPECTED"]);
  assert.equal(receipt.cleanup, "removed");
  assert.ok(!JSON.stringify(receipt).includes("PRIVATE_CANARY"));
});
test("identity drift observed during the probe cannot produce a verified receipt", (t) => {
  const pinned = target(t); let drifted = false;
  const receipt = runHostInventory(pinned, { process: (invocation) => {
    const result = spawnSync(invocation.executable, invocation.args, {
      cwd: invocation.cwd, env: invocation.env, encoding: "utf8", timeout: invocation.timeoutMs,
      maxBuffer: invocation.maxOutputBytes
    });
    if (!drifted) { writeFileSync(join(pinned.packageDirectory, "cli-main.js"), "Changed identity.\n"); drifted = true; }
    return { status: result.status, stdout: result.stdout ?? "", failure: result.error ? "process" : null };
  } });
  assert.deepEqual(receipt.errorCodes, ["HOST_IDENTITY_MISMATCH"]); assert.equal(receipt.cleanup, "removed");
  assert.equal(receipt.inventoryExclusivity, "unavailable"); assert.equal(receipt.status, "unavailable");
});
test("cleanup refuses a substituted fixture-root link and never deletes its target", (t) => {
  const pinned = target(t); const outside = join(pinned.packageDirectory, "outside");
  mkdirSync(outside); const marker = join(outside, "marker"); writeFileSync(marker, "retain");
  let link: string | null = null;
  const receipt = runHostInventory(pinned, { process: (invocation) => {
    link = dirname(invocation.cwd);
    renameSync(link, join(pinned.packageDirectory, "displaced"));
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    return { status: 1, stdout: "", failure: null };
  } });
  assert.equal(receipt.cleanup, "failed"); assert.ok(receipt.errorCodes.includes("CLEANUP_FAILED"));
  assert.ok(existsSync(marker)); assert.equal(readFileSync(marker, "utf8"), "retain");
  assert.ok(link); rmSync(link);
});
test("substituted home is rejected before any subsequent child or configuration mutation", (t) => {
  const pinned = target(t); const outside = join(pinned.packageDirectory, "outside-settings");
  const outsideSkill = join(outside, "skills", "fde-personal-canary");
  mkdirSync(outsideSkill, { recursive: true }); writeFileSync(join(outsideSkill, "SKILL.md"), "retain");
  const settings = join(outside, "settings.json");
  const original = JSON.stringify({ disabledSkills: ["fde-personal-canary"] });
  writeFileSync(settings, original);
  let substituted = false; let callsAfterSubstitution = 0;
  const commands: string[][] = [];
  const receipt = runHostInventory(pinned, { process: (invocation) => {
    commands.push(invocation.args.slice(5));
    if (substituted) {
      callsAfterSubstitution++;
      return { status: 1, stdout: "", failure: null };
    }
    const result = spawnSync(invocation.executable, invocation.args, {
      cwd: invocation.cwd, env: invocation.env, encoding: "utf8", timeout: invocation.timeoutMs,
      maxBuffer: invocation.maxOutputBytes
    });
    if (invocation.args.includes("disable")) {
      const home = invocation.env.COPILOT_HOME; assert.ok(home);
      renameSync(home, `${home}-original`); symlinkSync(outside, home, process.platform === "win32" ? "junction" : "dir");
      substituted = true;
    }
    return { status: result.status, stdout: result.stdout ?? "", failure: result.error ? "process" : null };
  } });
  assert.equal(callsAfterSubstitution, 0);
  assert.deepEqual(commands.at(-1), ["skill", "disable", "fde-personal-canary"]);
  assert.deepEqual(receipt.errorCodes, ["FIXTURE_SCOPE_INVALID"]); assert.equal(receipt.cleanup, "removed");
  assert.equal(readFileSync(settings, "utf8"), original);
});
for (const directory of ["cwd", "HOME", "USERPROFILE", "COPILOT_HOME", "APPDATA", "LOCALAPPDATA",
  "TEMP", "TMP", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"] as const) {
  for (const beforeMutation of [false, true]) {
    test(`substituted ${directory} blocks the next ${beforeMutation ? "fixture mutation" : "child invocation"}`, (t) => {
      const pinned = target(t); const outside = join(pinned.packageDirectory, "outside-redirect");
      mkdirSync(outside); writeFileSync(join(outside, "marker"), "retain");
      let substituted = false; let subsequentCalls = 0;
      const receipt = runHostInventory(pinned, { process: (invocation) => {
        if (substituted) {
          subsequentCalls++;
          return { status: 1, stdout: "", failure: null };
        }
        const result = spawnSync(invocation.executable, invocation.args, {
          cwd: invocation.cwd, env: invocation.env, encoding: "utf8", timeout: invocation.timeoutMs,
          maxBuffer: invocation.maxOutputBytes
        });
        if (beforeMutation ? invocation.args.includes("mcp") : invocation.args.includes("--version")) {
          const redirected = directory === "cwd" ? invocation.cwd : invocation.env[directory];
          assert.ok(redirected);
          renameSync(redirected, `${redirected}-original`);
          symlinkSync(outside, redirected, process.platform === "win32" ? "junction" : "dir");
          substituted = true;
        }
        return { status: result.status, stdout: result.stdout ?? "", failure: result.error ? "process" : null };
      } });
      assert.equal(substituted, true); assert.equal(subsequentCalls, 0);
      assert.deepEqual(receipt.errorCodes, ["FIXTURE_SCOPE_INVALID"]);
      assert.equal(receipt.cleanup, "removed"); assertOwnedCleanup(pinned);
      assert.deepEqual(readdirSync(outside), ["marker"]);
      assert.equal(readFileSync(join(outside, "marker"), "utf8"), "retain");
      assert.ok(!JSON.stringify(receipt).includes(outside));
    });
  }
}
for (const nested of [false, true]) {
  test(`linked ${nested ? "cwd parent" : "cwd"} is rejected before creating disposable directories`, (t) => {
    const pinned = target(t); const physical = join(pinned.packageDirectory, "physical-workspace");
    mkdirSync(physical); if (nested) mkdirSync(join(physical, "workspace"));
    const linked = join(pinned.packageDirectory, "linked-workspace");
    symlinkSync(physical, linked, process.platform === "win32" ? "junction" : "dir");
    const cwd = nested ? join(linked, "workspace") : linked;
    const physicalLocal = join(physical, ...(nested ? ["workspace"] : []), ".local");
    t.mock.method(process, "cwd", () => cwd);
    let calls = 0;
    const receipt = runHostInventory(pinned, { process: () => {
      calls++; throw new Error("PRIVATE_CANARY");
    } });
    assert.equal(existsSync(physicalLocal), false);
    assert.equal(calls, 0); assert.deepEqual(receipt.errorCodes, ["FIXTURE_SCOPE_INVALID"]);
    assert.equal(receipt.cleanup, "not-created");
  });
}
test("diagnostic CLI requires opt-in and emits only a validated sanitized receipt", (t) => {
  const pinned = target(t); const path = join(pinned.packageDirectory, "target.json");
  writeFileSync(path, JSON.stringify(pinned));
  const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/host-inventory.ts", "--inventory-only", path], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024
  });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, "");
  assert.equal(HostInventoryReceipt.parse(JSON.parse(child.stdout)).status, "observed");
  assert.ok(!child.stdout.includes(path)); assert.ok(!child.stdout.includes("PRIVATE_CANARY"));
  const rejected = spawnSync(process.execPath, ["--import", "tsx", "scripts/host-inventory.ts", path], { encoding: "utf8" });
  assert.equal(rejected.status, 1); assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr.trim(), "HOST_INVENTORY_ARGUMENTS_INVALID");
  writeFileSync(path, "{PRIVATE_CANARY");
  const malformed = spawnSync(process.execPath, ["--import", "tsx", "scripts/host-inventory.ts", "--inventory-only", path], { encoding: "utf8" });
  assert.equal(malformed.status, 1); assert.equal(malformed.stdout, "");
  assert.equal(malformed.stderr.trim(), "HOST_INVENTORY_TARGET_READ_FAILED");
});
