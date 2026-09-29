import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertExecutionDisabled, inspectManifest } from "./manifest.js";

export function runCommand(command: string, manifest: unknown) {
  const inspection = inspectManifest(manifest, new Date().toISOString());
  if (command === "preflight") return {
    status: "not-run", manifestReady: inspection.ready,
    blockers: [...inspection.reasons, "Live executor is intentionally disabled",
      "OS isolation, provider-internal call admission and private episode scripts are not verified"]
  };
  if (command !== "measured" && command !== "live") throw new Error("Unknown command");
  if (!inspection.ready) throw new Error(`MANIFEST_REJECTED: ${inspection.reasons.join("; ")}`);
  return assertExecutionDisabled();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2] ?? "preflight";
    const manifest: unknown = JSON.parse(readFileSync(process.argv[3] ?? "experiment/manifest.draft.json", "utf8"));
    console.log(JSON.stringify(runCommand(command, manifest), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
