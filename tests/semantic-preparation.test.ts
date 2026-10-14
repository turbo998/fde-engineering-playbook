import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { PrivateSemanticCompanion, TypedSemanticEpisode } from "../packages/lab/src/semantic-episode-schema.js";
import {
  PrivateBundle, semanticCompanionSchemaDigest, validateSemanticCompanion, validateSemanticCompanionFiles
} from "../packages/lab/src/private-fixtures.js";
import { digest } from "../packages/lab/src/encoding.js";
import { semanticVector } from "./semantic-helpers.js";
import { clock, sandbox } from "./helpers.js";

function preparations() {
  const v = semanticVector();
  const cases = Array.from({ length: 12 }, (_, i) => ({
    id: `unit-preparation-${i}`, caseId: `unit-case-${i}`, title: "UNIT_SEMANTIC_CANARY",
    omitResourceIds: [], faults: [], episode: ["UNIT_SEMANTIC_CANARY: process.exit(99)"],
    additionalAssertions: ["UNIT_SEMANTIC_CANARY: typed state equality"],
    oracle: {
      tenantId: v.oracle.tenantId, caseId: `unit-case-${i}`, allowedStatuses: ["completed"],
      allowedEffects: [], requiredEffectKeys: [], requiredBookingTargets: [], requiredClaimIds: [],
      evidenceIds: ["unit-evidence"]
    }
  }));
  const source = PrivateBundle.parse({
    schemaVersion: 1, kind: "private-synthetic-holdout-preparation", executionStatus: "not-run",
    repetitionsPerScenario: 3, clock, policyVersion: v.oracle.policyVersion,
    publication: "unit-private", adapterStatus: "unit-unexecuted", identifierContract: "unit-neutral",
    policy: { ...v.oracle.policy, replacementAlwaysRequiresApproval: true, currency: "XXX",
      syntheticExcessCostThresholdMinorUnits: 1, boundaryConvention: "inclusive", supplierCommunicationDefault: "unsent-draft" },
    actors: v.oracle.actors, resources: v.oracle.fixtures.map((f) => f.resource), cases,
    verificationBoundary: { schemaCompatibility: "unit", additionalAssertions: "unit", fixturePreparationIsNot: ["benchmark"] }
  });
  const bytes = JSON.stringify(source);
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const entries = source.cases.map((original) => {
    const oracle = structuredClone(v.oracle);
    oracle.caseId = original.caseId; oracle.allowedStatuses = ["completed"];
    oracle.plans = []; oracle.decisions = []; oracle.requiredAudit = []; oracle.manualEvents = [];
    oracle.requiredEffectKeys = []; oracle.requiredBookingTargets = []; oracle.requiredRules = ["terminal-status"];
    const observation = { ...v.observation, caseId: original.caseId, bookings: [], handoff: null,
      audit: [], approvalHistory: [], attemptAudit: [] };
    const script = TypedSemanticEpisode.parse({
      schemaVersion: 3, kind: "private-typed-semantic-preparation", executionStatus: "not-run", id: original.id,
      dataset: { clock, policyVersion: oracle.policyVersion, fixtures: oracle.fixtures, faults: [] },
      steps: [{ kind: "observe", expected: observation }], oracle,
      sourceStepMappings: [{
        sourceIndex: 0, sourceDigest: digest(original.episode[0]), typedStepIndices: [0],
        rationale: "A hand-authored typed observation, not interpreted source prose."
      }]
    });
    return {
      script, scriptDigest: digest(script),
      assertions: [{ sourceIndex: 0, sourceDigest: digest(original.additionalAssertions[0]),
        category: "implemented-machine-rule", rules: ["terminal-status"], rationale: "Exact typed status.",
        unavailableParts: [] }]
    };
  });
  const companion = PrivateSemanticCompanion.parse({
    schemaVersion: 3, kind: "private-semantic-companion", executionStatus: "not-run",
    sourceSHA256: sourceHash, schemaDigest: semanticCompanionSchemaDigest(), implementationCommit: "0".repeat(40),
    cases: entries
  });
  return { source, bytes, sourceHash, companion };
}
test("companion classifies every original assertion and step by digest without claiming execution", () => {
  const { source, sourceHash, companion } = preparations();
  const report = validateSemanticCompanion(source, companion, sourceHash);
  assert.deepEqual(report.errorCodes, []);
  assert.deepEqual(report.counts, { cases: 12, sourceSteps: 12, typedSteps: 12, assertions: 12, executedEpisodes: 0 });
  assert.equal(report.coverage?.["implemented-machine-rule"], 12);
  assert.ok(!JSON.stringify(report).includes("UNIT_SEMANTIC_CANARY"));
});
test("assertions cannot silently disappear, change meaning, or claim machine coverage for unavailable prose", () => {
  for (const variant of ["drop", "digest", "schema", "source", "policy", "status", "fixtures", "script-digest", "overclaim"]) {
    const { source, sourceHash, companion } = preparations();
    const entry = companion.cases[0]; assert.ok(entry);
    const assertion = entry.assertions[0]; assert.ok(assertion);
    if (variant === "drop") entry.assertions = [];
    if (variant === "digest") assertion.sourceDigest = "0".repeat(64);
    if (variant === "schema") companion.schemaDigest = "0".repeat(64);
    if (variant === "source") companion.sourceSHA256 = "0".repeat(64);
    if (variant === "policy") entry.script.oracle.policy.requiredClass = "unit-other";
    if (variant === "status") entry.script.oracle.allowedStatuses = ["failed"];
    if (variant === "fixtures") entry.script.dataset.fixtures.pop();
    if (variant === "script-digest") entry.scriptDigest = "0".repeat(64);
    if (variant === "overclaim") assertion.unavailableParts = ["arbitrary prose remains unsupported"];
    if (variant !== "script-digest") entry.scriptDigest = digest(entry.script);
    assert.ok(validateSemanticCompanion(source, companion, sourceHash).errorCodes.length, variant);
  }
});
test("companion file CLI returns hashes/counts/categories only, with sanitized read/JSON/schema failures", (t) => {
  const { source, bytes, sourceHash, companion } = preparations();
  const directory = sandbox(t).path;
  const sourcePath = `${directory}.source.json`; const companionPath = `${directory}.companion.json`;
  writeFileSync(sourcePath, bytes); writeFileSync(companionPath, JSON.stringify(companion));
  const report = validateSemanticCompanionFiles(sourcePath, companionPath, sourceHash);
  assert.deepEqual(report.errorCodes, []);
  const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-semantic.ts",
    sourcePath, companionPath, sourceHash], { encoding: "utf8" });
  assert.equal(child.status, 0); assert.equal(child.stderr, "");
  assert.deepEqual(JSON.parse(child.stdout), report);
  assert.ok(!child.stdout.includes("UNIT_SEMANTIC_CANARY")); assert.ok(!child.stdout.includes(sourcePath));
  writeFileSync(companionPath, "{UNIT_SEMANTIC_CANARY");
  assert.deepEqual(validateSemanticCompanionFiles(sourcePath, companionPath, sourceHash).errorCodes, ["PREPARATION_JSON_INVALID"]);
  writeFileSync(companionPath, JSON.stringify({ ...companion, executionStatus: "completed" }));
  const failed = spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-semantic.ts",
    sourcePath, companionPath, sourceHash], { encoding: "utf8" });
  assert.equal(failed.status, 1); assert.equal(failed.stderr, "");
  assert.ok(!failed.stdout.includes("UNIT_SEMANTIC_CANARY")); assert.ok(!failed.stdout.includes(companionPath));
  assert.deepEqual(validateSemanticCompanionFiles(`${sourcePath}.missing`, companionPath, sourceHash).errorCodes,
    ["PREPARATION_READ_FAILED"]);
  assert.deepEqual(validateSemanticCompanion(source, companion, "0".repeat(64)).errorCodes, ["COMPANION_SOURCE_HASH_MISMATCH"]);
});
