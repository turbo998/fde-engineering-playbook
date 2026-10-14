import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const mode = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).fixtureMode;
const args = process.argv.slice(2);
const home = process.env.COPILOT_HOME;
const settingsPath = join(home, "settings.json");
writeFileSync(join(root, "observed-cwd.txt"), process.cwd());
if (mode === "process-failure") process.exit(17);
if (mode === "timeout") await new Promise((resolve) => setTimeout(resolve, 60_000));
if (mode === "output-limit") {
  await new Promise((resolve, reject) => {
    process.stdout.write("x".repeat(2 * 1024 * 1024), (error) => error ? reject(error) : resolve());
  });
  process.exit(0);
}
if (args.includes("--version")) {
  console.log(`GitHub Copilot CLI ${mode === "wrong-version" ? "1.0.72-1" : "1.0.95-3"}.`);
  console.log("Use copilot version to inspect full version metadata.");
} else if (args.includes("disable")) {
  writeFileSync(settingsPath, JSON.stringify({ disabledSkills: ["fde-personal-canary"] }));
} else if (args.includes("skill")) {
  if (mode === "malformed") { console.log("{PRIVATE_CANARY"); process.exit(0); }
  if (mode === "unknown-shape") { console.log('{"skills":[]}'); process.exit(0); }
  const disabled = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")).disabledSkills : [];
  const entry = (name, source, path) => ({
    name, source, path, enabled: mode === "ineffective-disable" || !disabled.includes(name),
    description: "PRIVATE_CANARY_DESCRIPTION_DO_NOT_EMIT"
  });
  const entries = [
    entry("unit-builtin-a", "builtin", join(root, "builtin-a")),
    entry("unit-builtin-b", "builtin", join(root, "builtin-b")),
    entry("unit-inherited", "inherited", join(root, "inherited"))
  ];
  const personalDir = join(home, "skills", "fde-personal-canary");
  if (existsSync(personalDir)) entries.push(entry("fde-personal-canary", "personal-copilot", join(personalDir, "SKILL.md")));
  const treatmentDir = join(process.cwd(), ".github", "skills", "fde-method-canary");
  if (existsSync(treatmentDir)) {
    entries.push(entry("fde-method-canary", "project", join(treatmentDir, "SKILL.md")));
    if (mode === "unexpected-treatment") entries.push(entry("unit-extra", "project", join(root, "extra")));
    if (mode === "wrong-treatment-path") entries.at(-1).path = join(root, "outside-treatment");
    if (mode === "missing-builtin") entries.shift();
  }
  if (mode === "unknown-source") entries[0].source = "__proto__";
  if (mode === "missing-enabled") delete entries[0].enabled;
  if (mode === "duplicate-names") entries.push({ ...entries[0] });
  if (mode === "baseline-disable-ineffective" && disabled.includes("unit-inherited")) entries[2].enabled = true;
  console.log(JSON.stringify(entries));
} else if (args.includes("instruction")) {
  const instructions = existsSync(join(home, "copilot-instructions.md")) ? [
    { defaultDisabled: false, id: "unit-personal", label: "PRIVATE_CANARY", location: "home",
      sourcePath: join(home, "copilot-instructions.md"), type: "home" },
    { defaultDisabled: false, id: "unit-workspace", label: "PRIVATE_CANARY", location: "workspace",
      sourcePath: join(process.cwd(), "AGENTS.md"), type: "model" }
  ] : [];
  if (mode === "unknown-instruction" && instructions.length) delete instructions[0].defaultDisabled;
  console.log(JSON.stringify(instructions));
} else if (args.includes("plugin")) {
  console.log(mode === "unknown-plugin" ? '[{"name":"PRIVATE_CANARY"}]' : "[]");
} else if (args.includes("mcp")) {
  console.log(mode === "unknown-mcp" ? '{"mcpServers":{"private":{"command":"PRIVATE_CANARY"}}}' : '{"mcpServers":{}}');
} else {
  process.exit(18);
}
