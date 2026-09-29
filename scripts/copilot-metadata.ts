import { CopilotClient } from "@github/copilot-sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.argv[2] !== "--metadata-only") throw new Error("Explicit --metadata-only required; not part of offline CI");
const state = resolve(".local", "metadata-discovery");
mkdirSync(state, { recursive: true });
const client = new CopilotClient({
  mode: "empty", baseDirectory: state, workingDirectory: process.cwd(),
  useLoggedInUser: true, logLevel: "none"
});
const watchdog = setTimeout(() => {
  console.error("METADATA_TIMEOUT: no inference requested");
  void client.forceStop().finally(() => { process.exitCode = 1; });
}, 60_000);
try {
  await client.start();
  const auth = await client.getAuthStatus();
  const models = auth.isAuthenticated ? await client.listModels() : [];
  const report = {
    kind: "metadata-only-not-inference",
    observedAt: new Date().toISOString(),
    sdkVersion: "1.0.15",
    authenticated: auth.isAuthenticated,
    models: models.map((model) => ({
      id: model.id, policy: model.policy?.state ?? "unavailable",
      reasoning: model.supportedReasoningEfforts ?? null,
      billing: model.billing ?? null
    })),
    modelSelection: null,
    inferenceVerified: false
  };
  writeFileSync(resolve(".local", "copilot-metadata.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(watchdog);
  const errors = await client.stop();
  if (errors.length) throw new AggregateError(errors, "Metadata client cleanup failed");
}
