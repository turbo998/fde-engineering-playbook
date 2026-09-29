import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { PrivateBundle, validatePrivateBundle, validatePrivateFile } from "../packages/lab/src/private-fixtures.js";
import { clock, request, sandbox } from "./helpers.js";

function bundle() {
  return PrivateBundle.parse({
    schemaVersion: 1, kind: "private-synthetic-holdout-preparation", executionStatus: "not-run",
    repetitionsPerScenario: 3, clock, policyVersion: request.policyVersion,
    publication: "unit-private", adapterStatus: "unit-text-only", identifierContract: "unit-ids",
    policy: {
      replacementAlwaysRequiresApproval: true, maximumDistanceMetres: 1, requiredClass: "unit",
      requiredRoomCategory: "unit", requiredOccupancy: 1, currency: "XXX",
      syntheticExcessCostThresholdMinorUnits: 1, arrivalWindowHours: 1, supplierLookbackDays: 1,
      boundaryConvention: "unit", supplierCommunicationDefault: "unit"
    },
    actors: [{ actorId: request.actorId, tenantId: request.tenantId, roles: ["operations_agent"], sessionId: "unit-session" }],
    resources: [
      { kind: "evidence", data: { id: "unit-evidence", tenantId: request.tenantId, source: "direct",
        sourceRef: "unit-source", version: "unit-version", observedAt: clock, statement: "UNIT_PRIVATE_CANARY" } },
      { kind: "hotel", data: { id: request.targetId, tenantId: request.tenantId, name: "unit", class: "unit",
        roomCategory: "unit", occupancy: 1, distanceMetres: 1, address: "unit", capacity: "available",
        evidenceIds: ["unit-evidence"] } }
    ],
    cases: Array.from({ length: 12 }, (_, index) => ({
      id: `unit-${index}`, caseId: `unit-case-${index}`, title: "UNIT_PRIVATE_CANARY",
      omitResourceIds: [], faults: [],
      episode: ["process.exit(99); // UNIT_PRIVATE_CANARY - data only, never executed"],
      additionalAssertions: ["UNIT_PRIVATE_CANARY"],
      oracle: { tenantId: request.tenantId, caseId: `unit-case-${index}`, allowedStatuses: ["completed"],
        allowedEffects: [{ ...request, caseId: `unit-case-${index}` }], requiredEffectKeys: [request.idempotencyKey],
        requiredBookingTargets: [request.targetId], requiredClaimIds: [], evidenceIds: request.evidenceIds }
    })),
    verificationBoundary: { schemaCompatibility: "unit", additionalAssertions: "unit", fixturePreparationIsNot: ["execution"] }
  });
}
test("private preparation validates references but natural-language steps and assertions are never executed", () => {
  const report = validatePrivateBundle(bundle());
  assert.deepEqual(report.errorCodes, []);
  assert.equal(report.counts.executedEpisodes, 0);
  assert.equal(report.counts.unsupportedAssertions, 12);
  assert.equal(report.counts.textualSteps, 12);
  assert.ok(!JSON.stringify(report).includes("UNIT_PRIVATE_CANARY"));
});
test("private validation reports only codes for duplicate IDs/faults and broken case, evidence, actor and booking references", () => {
  const input = bundle();
  const first = input.cases[0];
  const second = input.cases[1];
  assert.ok(first && second);
  second.id = first.id;
  second.caseId = first.caseId;
  first.omitResourceIds.push(request.targetId, "missing");
  first.oracle.evidenceIds.push("missing");
  const effect = first.oracle.allowedEffects[0];
  assert.ok(effect);
  effect.actorId = "unknown";
  effect.evidenceIds.push("missing");
  effect.policyVersion = "wrong-policy";
  first.faults.push({ operation: "read", call: 1, code: "retrieval_failure" },
    { operation: "read", call: 1, code: "retrieval_failure" });
  const report = validatePrivateBundle(input);
  for (const code of ["DUPLICATE_CASE_ID", "DUPLICATE_CASE_REFERENCE", "ORACLE_CASE_MISMATCH", "DUPLICATE_FAULT_SLOT",
    "OMISSION_REFERENCE_INVALID", "ORACLE_EVIDENCE_REFERENCE_INVALID", "EFFECT_ACTOR_REFERENCE_INVALID",
    "EFFECT_EVIDENCE_REFERENCE_INVALID", "EFFECT_POLICY_VERSION_MISMATCH", "BOOKING_TARGET_REFERENCE_INVALID"]) {
    assert.ok(report.errorCodes.includes(code), code);
  }
  assert.ok(!JSON.stringify(report).includes("UNIT_PRIVATE_CANARY"));
});
test("references resolve within tenant, not merely by matching ID", () => {
  const input = bundle();
  const evidence = input.resources[0];
  const actor = input.actors[0];
  assert.ok(evidence && actor);
  evidence.data.tenantId = "other-tenant";
  actor.tenantId = "other-tenant";
  input.resources.push({ kind: "arrival", data: {
    id: "unit-arrival", tenantId: "other-tenant", hotelId: request.targetId,
    arrivalAt: clock, reconfirmation: "missing", evidenceIds: []
  } });
  const report = validatePrivateBundle(input);
  assert.ok(report.errorCodes.includes("RESOURCE_EVIDENCE_REFERENCE_INVALID"));
  assert.ok(report.errorCodes.includes("ORACLE_EVIDENCE_REFERENCE_INVALID"));
  assert.ok(report.errorCodes.includes("EFFECT_ACTOR_REFERENCE_INVALID"));
  assert.ok(report.errorCodes.includes("RESOURCE_HOTEL_REFERENCE_INVALID"));
});
test("strict private schema rejects unsupported fields and unbound required effect keys", () => {
  assert.deepEqual(validatePrivateBundle({ ...bundle(), unexpected: "UNIT_PRIVATE_CANARY" }).errorCodes, ["FIXTURE_SCHEMA_INVALID"]);
  const input = bundle();
  input.cases[0]?.oracle.requiredEffectKeys.push("not-allowed");
  assert.deepEqual(validatePrivateBundle(input).errorCodes, ["FIXTURE_SCHEMA_INVALID"]);
});
test("private file CLI reports raw-byte hash/counts/codes only and rejects malformed JSON, missing file and hash mismatch", (t) => {
  const file = `${sandbox(t).path}.json`;
  const bytes = JSON.stringify(bundle());
  writeFileSync(file, bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const report = validatePrivateFile(file, hash);
  assert.equal(report.hash, hash);
  assert.deepEqual(report.errorCodes, []);
  assert.deepEqual(validatePrivateFile(file, "0".repeat(64)).errorCodes, ["FIXTURE_HASH_MISMATCH"]);
  const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-private.ts", file, hash], { encoding: "utf8" });
  assert.equal(child.status, 0);
  assert.equal(child.stderr, "");
  assert.deepEqual(JSON.parse(child.stdout), report);
  assert.ok(!child.stdout.includes(file));
  assert.ok(!child.stdout.includes("UNIT_PRIVATE_CANARY"));
  writeFileSync(file, "{ UNIT_PRIVATE_CANARY");
  assert.deepEqual(validatePrivateFile(file).errorCodes, ["FIXTURE_JSON_INVALID"]);
  const failed = spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-private.ts", file], { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.equal(failed.stderr, "");
  assert.ok(!failed.stdout.includes("UNIT_PRIVATE_CANARY"));
  assert.ok(!failed.stdout.includes(file));
  assert.deepEqual(validatePrivateFile(`${file}.missing`).errorCodes, ["FIXTURE_READ_FAILED"]);
});
