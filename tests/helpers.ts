import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import type { TestContext } from "node:test";
import { EffectRequest } from "../packages/contracts/src/index.js";
import { digest } from "../packages/lab/src/encoding.js";

export function sandbox(t: TestContext) {
  mkdirSync(resolve(".local"), { recursive: true });
  const directory = mkdtempSync(resolve(".local", "unit-"));
  const resources: { close(): void }[] = [];
  t.after(() => {
    for (const resource of resources.reverse()) resource.close();
    rmSync(directory, { recursive: true });
  });
  return {
    path: join(directory, "test.sqlite"),
    keep<T extends { close(): void }>(resource: T): T { resources.push(resource); return resource; }
  };
}

// Generic protocol fixtures only: not scenario scripts, policy thresholds or holdout answers.
export const clock = "2000-01-01T00:00:00.000Z";
export const request = EffectRequest.parse({
  tenantId: "unit-tenant", caseId: "unit-case", actorId: "unit-actor",
  action: "replacement_confirmation", idempotencyKey: "unit-key", targetId: "unit-target",
  planVersion: "unit-plan", policyVersion: "unit-policy",
  cost: { minorUnits: 1, currency: "XXX" }, approvalId: null, evidenceIds: ["unit-evidence"]
});
export const dataset = { clock, policyVersion: "unit-policy", fixtures: [], faults: [] };
export function limits() {
  const cap = { requests: 3, reservedOutputTokens: 12, aiCredits: 2 };
  return {
    perArm: { baseline: { ...cap }, hve: { ...cap }, superpowers: { ...cap }, gstack: { ...cap } },
    total: { requests: 5, reservedOutputTokens: 20, aiCredits: 4 },
    maxOutputTokensPerCall: 4, maxAttemptsPerEpisode: 2,
    maxElapsedMs: 1000, softCreditOverrunAcknowledged: true as const
  };
}
export function approvedUnitManifest() {
  const verified = { status: "verified" as const, evidenceDigest: "0".repeat(64) };
  const base = {
    host: "copilot", hostVersion: "unit-1",
    model: { id: "unit-model", reasoning: "low", context: "default" },
    methodRevision: "0".repeat(40), methodPackageCount: 1,
    compatibility: verified, toolInventoryDigest: "0".repeat(64)
  };
  const configuration = {
    schemaVersion: 1, status: "approved", experimentId: "offline-unit-only",
    seedCommit: "0".repeat(40), scenarioManifestDigest: "0".repeat(64),
    holdoutDigest: "0".repeat(64), rubricDigest: "0".repeat(64),
    scenarioFamilies: 12, repeats: 3,
    order: ["hve", "baseline", "gstack", "superpowers"], orderSeed: "unit-order",
    arms: {
      baseline: { ...base, methodPackageCount: 0, methodRevision: null },
      hve: structuredClone(base), superpowers: structuredClone(base),
      gstack: { ...base, host: "codex" }
    },
    runtime: { provider: "copilot-sdk", sdkVersion: "unit-1", cliVersion: "unit-1", model: base.model },
    reviewer: { kind: "human", reviewerId: "unit-not-a-real-reviewer" },
    isolation: {
      cleanHome: verified, inventories: verified, canary: verified,
      processRestrictions: verified, seedOnly: verified, holdoutSealed: verified
    },
    limits: limits()
  };
  return {
    ...configuration,
    approval: {
      approvedBy: "unit-not-a-real-approval", approvedAt: clock,
      expiresAt: "2000-01-02T00:00:00.000Z", evidenceDigest: "0".repeat(64),
      configurationDigest: digest(configuration)
    }
  };
}
