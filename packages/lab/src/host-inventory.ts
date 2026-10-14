import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { Count } from "../../contracts/src/index.js";
import { digest } from "./encoding.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Text = z.string().min(1).max(4096);
const Name = z.string().min(1).max(256);
const SupportedVersion = z.literal("1.0.95-3");
const SkillSource = z.enum(["builtin", "inherited", "personal-copilot", "project"]);
const Sources = z.strictObject({
  builtin: Count, inherited: Count, "personal-copilot": Count, project: Count, home: Count, model: Count
});
const Skill = z.strictObject({
  name: Name, description: z.string().max(65536), path: Text, source: SkillSource, enabled: z.boolean()
});
const Skills = z.array(Skill).max(4096).superRefine((entries, ctx) => {
  if (new Set(entries.map((entry) => entry.name)).size !== entries.length) {
    ctx.addIssue({ code: "custom", message: "AMBIGUOUS_SKILL_NAMES" });
  }
});
const Instructions = z.array(z.strictObject({
  defaultDisabled: z.boolean(), id: Name, label: Text, location: Text,
  sourcePath: Text.nullable(), type: z.enum(["home", "model"])
})).max(4096);
const Settings = z.strictObject({ disabledSkills: z.array(Name).max(4096) });
const Kind = z.enum(["instruction", "skill", "plugin", "mcp"]);
const Phase = z.enum(["clean", "canary", "no-custom-instructions", "canary-disabled", "baseline", "treatment"]);
const Code = z.enum([
  "TARGET_INVALID", "HOST_IDENTITY_UNAVAILABLE", "HOST_IDENTITY_MISMATCH", "HOST_VERSION_UNSUPPORTED",
  "CLI_VERSION_MISMATCH", "CLI_PROCESS_FAILED", "CLI_PROCESS_TIMEOUT", "CLI_OUTPUT_LIMIT",
  "INVENTORY_JSON_INVALID", "INVENTORY_SHAPE_UNSUPPORTED", "CANARY_NOT_DISCOVERED",
  "CANARY_DISABLE_INEFFECTIVE", "TEMPORARY_SETTINGS_INVALID", "BASELINE_NOT_EXCLUSIVE",
  "TREATMENT_NOT_EXCLUSIVE", "FIXTURE_SCOPE_INVALID", "CLEANUP_FAILED", "HOST_DIAGNOSTIC_UNEXPECTED"
]);
export const HostInventoryTarget = z.strictObject({
  nodePath: Text.refine(isAbsolute), entryPath: Text.refine(isAbsolute),
  packageDirectory: Text.refine(isAbsolute), expectedVersion: SupportedVersion,
  sha256: z.strictObject({ node: Hash, entry: Hash, package: Hash, cliMain: Hash, runtime: Hash })
});
const Identity = z.strictObject({
  cliPackageVersion: SupportedVersion, nodeVersion: z.string().regex(/^v\d+\.\d+\.\d+$/),
  platform: z.enum(["win32", "linux", "darwin"]), architecture: z.enum(["arm64", "x64"]),
  sha256: HostInventoryTarget.shape.sha256
});
export const HostInventoryReceipt = z.strictObject({
  schemaVersion: z.literal(1), operation: z.literal("non-inference-host-inventory"),
  provenance: z.literal("synthetic"), status: z.enum(["observed", "failed", "unavailable"]),
  identity: Identity.nullable(),
  probes: z.array(z.strictObject({
    phase: Phase, kind: Kind, totalCount: Count.nullable(), enabledCount: Count.nullable(),
    enabledNonbuiltinCount: Count.nullable(), configuredMcpServers: Count.nullable(),
    sourceCounts: Sources.nullable(), responseSHA256: Hash.nullable(), enabledSetSHA256: Hash.nullable()
  })),
  baselineEnabledCount: Count.nullable(), baselineEnabledNonbuiltinCount: Count.nullable(),
  treatmentEnabledCount: Count.nullable(), treatmentEnabledNonbuiltinCount: Count.nullable(),
  inventoryExclusivity: z.enum(["verified", "failed", "unavailable"]),
  cleanup: z.enum(["not-created", "removed", "failed"]),
  fixtureWrites: z.literal("disposable-only"), modelRequests: z.literal(0),
  discoveryIsNotActivationProof: z.literal(true),
  activationVerified: z.literal(false), hostProjectedInstructionsVerified: z.literal(false),
  hooksAndMemoryVerified: z.literal(false), methodLoadingVerified: z.literal(false),
  osIsolationVerified: z.literal(false), crossArmIsolationVerified: z.literal(false),
  holdoutIsolationVerified: z.literal(false), nativePlatformSupport: z.null(),
  experimentalAuthorization: z.null(), errorCodes: z.array(Code)
});
export type InventoryInvocation = {
  executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  timeoutMs: number; maxOutputBytes: number;
};
const ProcessResult = z.strictObject({
  status: z.number().int().nullable(), stdout: z.string(),
  failure: z.enum(["timeout", "process", "output-limit"]).nullable()
});
export type InventoryProcess = (invocation: InventoryInvocation) => z.infer<typeof ProcessResult>;
type Skills = z.infer<typeof Skills>;
type Receipt = z.infer<typeof HostInventoryReceipt>;
class DiagnosticError extends Error {
  constructor(readonly code: z.infer<typeof Code>) { super(code); }
}
function fail(code: z.infer<typeof Code>): never { throw new DiagnosticError(code); }
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const sourceCounts = (): z.infer<typeof Sources> =>
  ({ builtin: 0, inherited: 0, "personal-copilot": 0, project: 0, home: 0, model: 0 });
const enabledSet = (entries: Skills) => entries.filter((entry) => entry.enabled)
  .map((entry) => digest({ name: entry.name, source: entry.source, path: entry.path })).sort();
const personal = "fde-personal-canary";
const treatment = "fde-method-canary";
const flags = ["--no-auto-update", "--no-remote", "--no-remote-export", "--disable-builtin-mcps"];
const maxOutputBytes = 1024 * 1024;

const execute: InventoryProcess = (invocation) => {
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: invocation.cwd, env: invocation.env, encoding: "utf8", timeout: invocation.timeoutMs,
    maxBuffer: invocation.maxOutputBytes, windowsHide: true
  });
  const code = result.error && "code" in result.error ? result.error.code : null;
  return {
    status: result.status, stdout: result.stdout ?? "",
    failure: code === "ETIMEDOUT" ? "timeout" : code === "ENOBUFS" ? "output-limit" :
      result.error || result.signal !== null ? "process" : null
  };
};

function regularFile(path: string, maximumBytes: number): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) fail("HOST_IDENTITY_UNAVAILABLE");
  return readFileSync(path);
}

function guardDirectoryAncestry(path: string): void {
  for (let current = resolve(path); ; current = dirname(current)) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) fail("FIXTURE_SCOPE_INVALID");
    if (current === dirname(current)) break;
  }
}

function identify(input: z.infer<typeof HostInventoryTarget>): z.infer<typeof Identity> {
  try {
    if (realpathSync(input.nodePath) !== realpathSync(process.execPath) ||
        resolve(input.entryPath) !== join(resolve(input.packageDirectory), "index.js")) fail("HOST_IDENTITY_MISMATCH");
    const packageBytes = regularFile(join(input.packageDirectory, "package.json"), maxOutputBytes);
    const manifest: unknown = JSON.parse(packageBytes.toString("utf8"));
    const parsed = z.object({ name: z.literal("@github/copilot"), version: SupportedVersion }).safeParse(manifest);
    if (!parsed.success) fail("HOST_VERSION_UNSUPPORTED");
    const observed = {
      node: sha256(regularFile(input.nodePath, 256 * 1024 * 1024)),
      entry: sha256(regularFile(input.entryPath, 256 * 1024 * 1024)), package: sha256(packageBytes),
      cliMain: sha256(regularFile(join(input.packageDirectory, "cli-main.js"), 256 * 1024 * 1024)),
      runtime: sha256(regularFile(join(input.packageDirectory, "prebuilds",
        `${process.platform}-${process.arch}`, "runtime.node"), 256 * 1024 * 1024))
    };
    if (digest(observed) !== digest(input.sha256)) fail("HOST_IDENTITY_MISMATCH");
    return Identity.parse({
      cliPackageVersion: parsed.data.version, nodeVersion: process.version,
      platform: process.platform, architecture: process.arch, sha256: observed
    });
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    return fail("HOST_IDENTITY_UNAVAILABLE");
  }
}

function environment(home: string): NodeJS.ProcessEnv {
  const inherited = new Set(["SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => inherited.has(key.toUpperCase())));
  return {
    ...env, HOME: home, USERPROFILE: home, COPILOT_HOME: join(home, ".copilot"),
    APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata"),
    TEMP: join(home, "temp"), TMP: join(home, "temp"),
    XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"),
    COPILOT_ALLOW_ALL: "false", COPILOT_OFFLINE: "true", NO_COLOR: "1"
  };
}

export function runHostInventory(input: unknown, options: {
  process?: InventoryProcess; timeoutMs?: number;
} = {}): Receipt {
  const report = HostInventoryReceipt.parse({
    schemaVersion: 1, operation: "non-inference-host-inventory", provenance: "synthetic", status: "unavailable",
    identity: null, probes: [], baselineEnabledCount: null, baselineEnabledNonbuiltinCount: null,
    treatmentEnabledCount: null, treatmentEnabledNonbuiltinCount: null, inventoryExclusivity: "unavailable",
    cleanup: "not-created", fixtureWrites: "disposable-only", modelRequests: 0, discoveryIsNotActivationProof: true,
    activationVerified: false, hostProjectedInstructionsVerified: false, hooksAndMemoryVerified: false,
    methodLoadingVerified: false, osIsolationVerified: false, crossArmIsolationVerified: false,
    holdoutIsolationVerified: false, nativePlatformSupport: null, experimentalAuthorization: null, errorCodes: []
  });
  const local = resolve(".local");
  let fixture: string | null = null;
  try {
    const target = HostInventoryTarget.safeParse(input);
    if (!target.success) fail("TARGET_INVALID");
    const timeout = z.number().int().min(1).max(30_000).safeParse(options.timeoutMs ?? 30_000);
    if (!timeout.success) fail("TARGET_INVALID");
    report.identity = identify(target.data);
    guardDirectoryAncestry(resolve(process.cwd()));
    guardDirectoryAncestry(local);
    mkdirSync(local, { recursive: true });
    if (lstatSync(local).isSymbolicLink() || realpathSync(local) !== local) fail("FIXTURE_SCOPE_INVALID");
    guardDirectoryAncestry(local);
    fixture = mkdtempSync(join(local, "host-inventory-"));
    const home = join(fixture, "home"); const cliHome = join(home, ".copilot");
    const cwd = join(fixture, "workspace");
    const ownedRoot = fixture;
    const guardFixturePath = (path: string) => {
      guardDirectoryAncestry(ownedRoot);
      if (resolve(path) !== path || !path.startsWith(`${ownedRoot}${sep}`) ||
          realpathSync(ownedRoot) !== ownedRoot) fail("FIXTURE_SCOPE_INVALID");
      for (let current = path; current !== ownedRoot; current = dirname(current)) {
        if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) fail("FIXTURE_SCOPE_INVALID");
      }
    };
    const env = environment(home);
    const guardManagedDirectories = (requireExisting = true) => {
      for (const directory of [cwd, home, ...[
        "HOME", "USERPROFILE", "COPILOT_HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
        "XDG_CONFIG_HOME", "XDG_CACHE_HOME"
      ].map((key) => env[key])]) {
        if (typeof directory !== "string") fail("FIXTURE_SCOPE_INVALID");
        guardFixturePath(directory);
        const stat = lstatSync(directory, { throwIfNoEntry: false });
        if (stat ? !stat.isDirectory() : requireExisting) fail("FIXTURE_SCOPE_INVALID");
      }
    };
    const writeFixture = (path: string, text: string) => {
      guardManagedDirectories();
      guardFixturePath(path); writeFileSync(path, text);
    };
    for (const directory of [cliHome, cwd, ...["appdata", "localappdata", "temp", "config", "cache"].map((p) => join(home, p))]) {
      guardManagedDirectories(false);
      guardFixturePath(directory);
      mkdirSync(directory, { recursive: true });
    }
    const deadline = Date.now() + 90_000;
    const invoke = (args: string[]) => {
      guardManagedDirectories();
      const remaining = deadline - Date.now();
      if (remaining <= 0) fail("CLI_PROCESS_TIMEOUT");
      const result = ProcessResult.safeParse((options.process ?? execute)({
        executable: target.data.nodePath, args: [target.data.entryPath, ...flags, ...args],
        cwd, env, timeoutMs: Math.min(timeout.data, remaining), maxOutputBytes
      }));
      if (!result.success) fail("CLI_PROCESS_FAILED");
      if (result.data.failure === "timeout") fail("CLI_PROCESS_TIMEOUT");
      if (result.data.failure === "output-limit" || Buffer.byteLength(result.data.stdout) > maxOutputBytes) fail("CLI_OUTPUT_LIMIT");
      if (result.data.failure !== null || result.data.status !== 0) fail("CLI_PROCESS_FAILED");
      return result.data.stdout;
    };
    const versionOutput = invoke(["--version"]).trim();
    const versionLines = versionOutput.split(/\r?\n/);
    const version = /^GitHub Copilot CLI (\d+\.\d+\.\d+-\d+)\.$/.exec(versionLines[0] ?? "");
    if (versionOutput.length > 512 || versionLines.length !== 2 ||
        !/^[\x20-\x7e]{1,256}$/.test(versionLines[1] ?? "") ||
        !versionLines[1]?.includes("copilot version") || version?.[1] !== target.data.expectedVersion) {
      fail("CLI_VERSION_MISMATCH");
    }
    const inventory = (phase: z.infer<typeof Phase>, kind: z.infer<typeof Kind>, noInstructions = false) => {
      const probe: Receipt["probes"][number] = {
        phase, kind, totalCount: null, enabledCount: null, enabledNonbuiltinCount: null,
        configuredMcpServers: null, sourceCounts: null, responseSHA256: null, enabledSetSHA256: null
      };
      report.probes.push(probe);
      const stdout = invoke([...(noInstructions ? ["--no-custom-instructions"] : []), kind, "list", "--json"]);
      probe.responseSHA256 = sha256(stdout);
      let value: unknown;
      try { value = JSON.parse(stdout); } catch { fail("INVENTORY_JSON_INVALID"); }
      if (kind === "skill") {
        const parsed = Skills.safeParse(value);
        if (!parsed.success) fail("INVENTORY_SHAPE_UNSUPPORTED");
        probe.totalCount = parsed.data.length;
        probe.enabledCount = parsed.data.filter((entry) => entry.enabled).length;
        probe.enabledNonbuiltinCount = parsed.data.filter((entry) => entry.enabled && entry.source !== "builtin").length;
        probe.sourceCounts = sourceCounts();
        for (const entry of parsed.data) probe.sourceCounts[entry.source]++;
        probe.enabledSetSHA256 = digest(enabledSet(parsed.data));
        return parsed.data;
      }
      if (kind === "instruction") {
        const parsed = Instructions.safeParse(value);
        if (!parsed.success) fail("INVENTORY_SHAPE_UNSUPPORTED");
        probe.totalCount = parsed.data.length; probe.sourceCounts = sourceCounts();
        for (const entry of parsed.data) probe.sourceCounts[entry.type]++;
      }
      if (kind === "plugin") {
        if (!z.array(z.never()).safeParse(value).success) fail("INVENTORY_SHAPE_UNSUPPORTED");
        probe.totalCount = 0;
      }
      if (kind === "mcp") {
        if (!z.strictObject({ mcpServers: z.strictObject({}) }).safeParse(value).success) fail("INVENTORY_SHAPE_UNSUPPORTED");
        probe.configuredMcpServers = 0;
      }
      return [];
    };
    inventory("clean", "instruction");
    const clean = inventory("clean", "skill");
    inventory("clean", "plugin"); inventory("clean", "mcp");
    const cleanBuiltin = enabledSet(clean.filter((entry) => entry.source === "builtin"));
    const personalDir = join(cliHome, "skills", personal);
    guardManagedDirectories();
    guardFixturePath(personalDir);
    mkdirSync(personalDir, { recursive: true });
    writeFixture(join(personalDir, "SKILL.md"),
      `---\nname: ${personal}\ndescription: Synthetic inventory canary.\n---\nInventory only; no model request.\n`);
    writeFixture(join(cliHome, "copilot-instructions.md"), "Synthetic personal instruction canary.\n");
    writeFixture(join(cwd, "AGENTS.md"), "Synthetic workspace instruction canary.\n");
    inventory("canary", "instruction"); inventory("no-custom-instructions", "instruction", true);
    const canary = inventory("canary", "skill");
    inventory("no-custom-instructions", "skill", true);
    if (!canary.some((entry) => entry.name === personal && entry.enabled && entry.source === "personal-copilot" &&
        [personalDir, join(personalDir, "SKILL.md")].includes(resolve(entry.path)))) fail("CANARY_NOT_DISCOVERED");
    invoke(["skill", "disable", personal]);
    const disabled = inventory("canary-disabled", "skill");
    if (!disabled.some((entry) => entry.name === personal && !entry.enabled)) fail("CANARY_DISABLE_INEFFECTIVE");
    const settingsPath = join(cliHome, "settings.json");
    let settings: z.infer<typeof Settings>;
    try {
      guardFixturePath(settingsPath);
      const parsed = Settings.safeParse(JSON.parse(regularFile(settingsPath, maxOutputBytes).toString("utf8")));
      if (!parsed.success || !parsed.data.disabledSkills.includes(personal)) fail("TEMPORARY_SETTINGS_INVALID");
      settings = parsed.data;
    } catch { fail("TEMPORARY_SETTINGS_INVALID"); }
    settings.disabledSkills = disabled.filter((entry) => entry.source !== "builtin").map((entry) => entry.name);
    writeFixture(settingsPath, `${JSON.stringify(settings)}\n`);
    const baseline = inventory("baseline", "skill", true);
    const baselineEnabled = baseline.filter((entry) => entry.enabled);
    report.baselineEnabledCount = baselineEnabled.length;
    report.baselineEnabledNonbuiltinCount = baselineEnabled.filter((entry) => entry.source !== "builtin").length;
    if (baselineEnabled.length === 0 || baselineEnabled.some((entry) => entry.source !== "builtin") ||
        digest(enabledSet(baseline)) !== digest(cleanBuiltin)) fail("BASELINE_NOT_EXCLUSIVE");
    const treatmentDir = join(cwd, ".github", "skills", treatment);
    guardManagedDirectories();
    guardFixturePath(treatmentDir);
    mkdirSync(treatmentDir, { recursive: true });
    writeFixture(join(treatmentDir, "SKILL.md"),
      `---\nname: ${treatment}\ndescription: Synthetic treatment canary.\n---\nInventory only; no method activation.\n`);
    const treated = inventory("treatment", "skill", true);
    const enabled = treated.filter((entry) => entry.enabled);
    const nonbuiltins = enabled.filter((entry) => entry.source !== "builtin");
    report.treatmentEnabledCount = enabled.length; report.treatmentEnabledNonbuiltinCount = nonbuiltins.length;
    const selected = nonbuiltins[0];
    if (nonbuiltins.length !== 1 || selected?.name !== treatment || selected.source !== "project" ||
        ![treatmentDir, join(treatmentDir, "SKILL.md")].includes(resolve(selected.path)) ||
        digest(enabledSet(enabled.filter((entry) => entry.source === "builtin"))) !== digest(cleanBuiltin)) {
      fail("TREATMENT_NOT_EXCLUSIVE");
    }
    report.identity = identify(target.data);
    report.inventoryExclusivity = "verified"; report.status = "observed";
  } catch (error) {
    const code = error instanceof DiagnosticError ? error.code : "HOST_DIAGNOSTIC_UNEXPECTED";
    report.errorCodes.push(code);
    if (["CANARY_NOT_DISCOVERED", "CANARY_DISABLE_INEFFECTIVE", "BASELINE_NOT_EXCLUSIVE", "TREATMENT_NOT_EXCLUSIVE"].includes(code)) {
      report.inventoryExclusivity = "failed"; report.status = "failed";
    }
  } finally {
    if (fixture !== null) {
      try {
        guardDirectoryAncestry(fixture);
        if (dirname(fixture) !== local || !basename(fixture).startsWith("host-inventory-") ||
            lstatSync(fixture).isSymbolicLink() || realpathSync(fixture) !== fixture) fail("FIXTURE_SCOPE_INVALID");
        rmSync(fixture, { recursive: true });
        report.cleanup = "removed";
        if (existsSync(fixture)) fail("CLEANUP_FAILED");
      } catch {
        report.cleanup = "failed"; report.status = "failed"; report.errorCodes.push("CLEANUP_FAILED");
      }
    }
  }
  return HostInventoryReceipt.parse(report);
}
