import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../packages/lab/src/encoding.js";
import { createDraftQualityRubric, QualityRubric, qualityRubricDigest } from "../packages/lab/src/quality-rubric.js";
import {
  BlindReviewPacket, prepareBlindReviewPacket, ReviewContext, ReviewReceipt, validateReviewReceipt
} from "../packages/lab/src/review-receipt.js";

const now = "2026-01-02T00:00:00Z";
function fixture(index = 0) {
  const rubric = createDraftQualityRubric(); const criterion = rubric.criteria[index];
  assert.ok(criterion);
  const scope = {
    candidateAlias: "candidate-0123456789abcdef", criterionId: criterion.id,
    artifactDigest: digest({ synthetic: "artifact" })
  };
  const reviewerConfiguration = { kind: "human" as const, reviewerId: "synthetic-reviewer", protocolDigest: digest({ synthetic: "protocol" }) };
  const context = ReviewContext.parse({
    schemaVersion: 1, rubricDigest: qualityRubricDigest(rubric), reviewerConfiguration,
    candidates: [{ candidateAlias: scope.candidateAlias, artifactDigest: scope.artifactDigest }],
    reviewerGrants: [{
      ...scope, id: "synthetic-grant", reviewerId: reviewerConfiguration.reviewerId,
      rubricDigest: qualityRubricDigest(rubric), configurationDigest: digest(reviewerConfiguration),
      authorityEvidenceDigest: digest({ synthetic: "authority" }), status: "approved",
      validFrom: "2026-01-01T00:00:00Z", expiresAt: "2026-01-03T00:00:00Z"
    }],
    evidence: criterion.requiredEvidence.map((kind) => ({
      ...scope, kind, sha256: digest({ synthetic: kind, criterion: criterion.id }),
      origin: ["rendered-artifact", "browser-trace"].includes(kind) ? "controller-capture" : "independent-service"
    })),
    notApplicable: [], hardFailures: []
  });
  const record = ReviewReceipt.parse({
    ...scope, rubricDigest: context.rubricDigest, disposition: "reviewed", rating: "met",
    reasonCode: null, reviewerGrantId: "synthetic-grant", evidenceHashes: context.evidence.map((item) => item.sha256),
    justification: "Synthetic contract fixture only; no actual review.", hardFailureCodes: []
  });
  return { rubric, context, record };
}
type Fixture = ReturnType<typeof fixture>;
function check(f: Fixture, record: unknown = f.record, context: unknown = f.context, expected = "schema-valid", time: unknown = now) {
  const result = validateReviewReceipt(f.rubric, record, context, time);
  assert.equal(result.status, expected, JSON.stringify(result));
  for (const field of ["reviewPerformanceVerified", "factualCorrectnessVerified", "reviewerAuthorityAuthenticated",
    "blindingAchieved", "benchmarkResultCreated"] as const) assert.equal(result[field], false);
  assert.ok(result.errorCodes.every((code) => /^[A-Z_]+$/.test(code)));
  assert.ok(!JSON.stringify(result).includes("Synthetic contract fixture"));
  return result;
}
function unavailable(f: Fixture) {
  return { ...f.record, disposition: "unavailable", rating: null, reasonCode: "REVIEW_NOT_PERFORMED",
    reviewerGrantId: null, evidenceHashes: [], justification: null };
}
function addFailure(f: Fixture) {
  const criterion = f.rubric.criteria[0]; const evidence = f.context.evidence[0];
  assert.ok(criterion); assert.ok(evidence);
  f.context.hardFailures.push({
    candidateAlias: f.record.candidateAlias, criterionId: f.record.criterionId, artifactDigest: f.record.artifactDigest,
    code: "FALSE_CONFIRMATION", evidenceHashes: [evidence.sha256]
  });
  f.record.hardFailureCodes = ["FALSE_CONFIRMATION"]; f.record.rating = "not-met";
}

test("neutral rubric is draft only: six anchors, three journeys and seven pending screening controls", () => {
  const rubric = createDraftQualityRubric();
  assert.equal(rubric.criteria.length, 6); assert.equal(rubric.browserJourneys.length, 3);
  assert.equal(rubric.accessibilityScreening.controls.length, 7);
  assert.equal(rubric.completedReviews, 0); assert.equal(rubric.executionStatus, "not-run");
  for (const key of ["approvedReviewer", "reviewerConfiguration", "blindAssignment", "budget"] as const) {
    assert.equal(rubric[key], null);
  }
  assert.equal(rubric.accessibilityScreening.conformanceClaim, false);
  assert.deepEqual(rubric.accessibilityScreening.assistiveTechValidated, []);
  assert.ok(rubric.accessibilityScreening.controls.every((control) => control.status === "pending"));
  assert.equal(qualityRubricDigest(rubric), digest(rubric));
  const reordered = Object.fromEntries(Object.entries(rubric).reverse());
  assert.equal(qualityRubricDigest(reordered), qualityRubricDigest(rubric));
  rubric.criteria[0]!.anchors.met = "A separately modified draft anchor.";
  assert.notEqual(qualityRubricDigest(rubric), qualityRubricDigest(createDraftQualityRubric()));
});
for (let index = 0; index < 6; index++) {
  test(`R0${index + 1} synthetic bound receipt validates only its contract`, () => { check(fixture(index)); });
}
test("rubric rejects unknown fields, duplicate criteria/controls and claimed approvals/reviews", () => {
  const rubric = createDraftQualityRubric();
  for (const invalid of [
    { ...rubric, approvedReviewer: "candidate-approval" }, { ...rubric, budget: 0 },
    { ...rubric, reviewerConfiguration: {} }, { ...rubric, blindAssignment: {} },
    { ...rubric, completedReviews: 1 }, { ...rubric, freezeStatus: "approved" },
    { ...rubric, privateExpectedAnswer: "PRIVATE_CANARY" },
    { ...rubric, criteria: [...rubric.criteria.slice(0, 5), rubric.criteria[0]] },
    { ...rubric, accessibilityScreening: { ...rubric.accessibilityScreening, conformanceClaim: true } },
    { ...rubric, accessibilityScreening: { ...rubric.accessibilityScreening,
      controls: [...rubric.accessibilityScreening.controls.slice(0, 6), rubric.accessibilityScreening.controls[0]] } }
  ]) {
    assert.equal(QualityRubric.safeParse(invalid).success, false);
    assert.throws(() => qualityRubricDigest(invalid), { message: "QUALITY_RUBRIC_INVALID" });
  }
});
const negatives: Array<[string, (f: Fixture) => { record?: unknown; context?: unknown; time?: unknown }]> = [
  ["null receipt", () => ({ record: null })],
  ["unknown receipt field cannot self-authorize", (f) => ({ record: { ...f.record, reviewerApproved: true } })],
  ["unknown context field", (f) => ({ context: { ...f.context, controllerApproved: true } })],
  ["null controller context", () => ({ context: null })],
  ["malformed context entry", (f) => ({ context: { ...f.context, evidence: [null] } })],
  ["null grant identifier", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], id: null }] } })],
  ["empty grant identifier", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], id: "" }] } })],
  ["duplicate grant identifiers", (f) => ({ context: { ...f.context, reviewerGrants: [...f.context.reviewerGrants, ...f.context.reviewerGrants] } })],
  ["unknown grant field", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], approved: true }] } })],
  ["unknown evidence field", (f) => ({ context: { ...f.context, evidence: [{ ...f.context.evidence[0], independent: true }] } })],
  ["reviewer configuration missing", (f) => ({ context: { ...f.context, reviewerConfiguration: null } })],
  ["configuration digest mismatch", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], configurationDigest: "0".repeat(64) }] } })],
  ["reviewer mismatch", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], reviewerId: "unapproved-reviewer" }] } })],
  ["grant absent", (f) => ({ context: { ...f.context, reviewerGrants: [] } })],
  ["grant criterion mismatch", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], criterionId: "R02" }] } })],
  ["grant candidate mismatch", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], candidateAlias: "candidate-fedcba9876543210" }] } })],
  ["grant artifact mismatch", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], artifactDigest: "0".repeat(64) }] } })],
  ["grant rubric mismatch", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], rubricDigest: "0".repeat(64) }] } })],
  ["invalid authority evidence hash", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], authorityEvidenceDigest: null }] } })],
  ["receipt grant identifier null", (f) => ({ record: { ...f.record, reviewerGrantId: null } })],
  ["grant revoked", (f) => ({ context: { ...f.context, reviewerGrants: [{ ...f.context.reviewerGrants[0], status: "revoked" }] } })],
  ["grant not yet effective", () => ({ time: "2025-12-31T23:59:59Z" })],
  ["grant expiry boundary", () => ({ time: "2026-01-03T00:00:00Z" })],
  ["invalid observation time", () => ({ time: "not-a-time" })],
  ["rubric digest mismatch", (f) => ({ record: { ...f.record, rubricDigest: "0".repeat(64) } })],
  ["context rubric digest mismatch", (f) => ({ context: { ...f.context, rubricDigest: "0".repeat(64) } })],
  ["candidate mismatch", (f) => ({ record: { ...f.record, candidateAlias: "candidate-fedcba9876543210" } })],
  ["artifact mismatch", (f) => ({ record: { ...f.record, artifactDigest: "0".repeat(64) } })],
  ["criterion mismatch", (f) => ({ record: { ...f.record, criterionId: "R02" } })],
  ["unknown criterion", (f) => ({ record: { ...f.record, criterionId: "R99" } })],
  ["unknown disposition", (f) => ({ record: { ...f.record, disposition: "passed" } })],
  ["missing required independent evidence", (f) => ({ record: { ...f.record, evidenceHashes: f.record.evidenceHashes.slice(0, 1) } })],
  ["candidate evidence cannot substitute for oracle", (f) => ({ context: { ...f.context, evidence: f.context.evidence.map((item) => ({ ...item, origin: "candidate" })) } })],
  ["captured prose cannot substitute for independent oracle", (f) => ({ context: { ...f.context, evidence: f.context.evidence.map((item) => ({ ...item, origin: "controller-capture" })) } })],
  ["evidence candidate scope mismatch", (f) => ({ context: { ...f.context, evidence: f.context.evidence.map((item) => ({ ...item, candidateAlias: "candidate-fedcba9876543210" })) } })],
  ["evidence artifact scope mismatch", (f) => ({ context: { ...f.context, evidence: f.context.evidence.map((item) => ({ ...item, artifactDigest: "0".repeat(64) })) } })],
  ["evidence criterion scope mismatch", (f) => ({ context: { ...f.context, evidence: f.context.evidence.map((item) => ({ ...item, criterionId: "R02" })) } })],
  ["duplicate evidence registry hashes", (f) => ({ context: { ...f.context, evidence: [...f.context.evidence, ...f.context.evidence] } })],
  ["duplicate receipt evidence hashes", (f) => ({ record: { ...f.record, evidenceHashes: [...f.record.evidenceHashes, ...f.record.evidenceHashes] } })],
  ["unregistered evidence hash", (f) => ({ record: { ...f.record, evidenceHashes: ["0".repeat(64)] } })],
  ["rating zero", (f) => ({ record: { ...f.record, rating: 0 } })],
  ["unsupported rating", (f) => ({ record: { ...f.record, rating: "passed" } })],
  ["null reviewed rating", (f) => ({ record: { ...f.record, rating: null } })],
  ["blank justification", (f) => ({ record: { ...f.record, justification: " " } })],
  ["unknown hard failure", (f) => ({ record: { ...f.record, hardFailureCodes: ["UNKNOWN"] } })],
  ["fabricated hard failure", (f) => ({ record: { ...f.record, hardFailureCodes: ["FALSE_CONFIRMATION"] } })]
];
for (const [name, change] of negatives) {
  test(`receipt rejects ${name}`, () => {
    const f = fixture(); const changed = change(f);
    check(f, Object.hasOwn(changed, "record") ? changed.record : f.record,
      Object.hasOwn(changed, "context") ? changed.context : f.context, "rejected",
      Object.hasOwn(changed, "time") ? changed.time : now);
  });
}
test("independently recorded hard failure cannot be hidden or offset by a positive rating", () => {
  const f = fixture(); addFailure(f); check(f);
  check(f, { ...f.record, rating: "met" }, f.context, "rejected");
  check(f, { ...f.record, rating: "partial" }, f.context, "rejected");
  check(f, { ...f.record, hardFailureCodes: [] }, f.context, "rejected");
  check(f, unavailable(f));
  check(f, { ...unavailable(f), hardFailureCodes: [] }, f.context, "rejected");
});
test("unavailable needs no reviewer and is always unscored, never zero or met", () => {
  const f = fixture(); f.context.reviewerConfiguration = null; f.context.reviewerGrants = [];
  const record = unavailable(f); check(f, record);
  for (const rating of [0, "met", "not-met"]) check(f, { ...record, rating }, f.context, "rejected");
  check(f, { ...record, reasonCode: null }, f.context, "rejected");
  check(f, { ...record, justification: "Candidate says reviewed." }, f.context, "rejected");
  check(f, { ...record, reviewerGrantId: "self-approved" }, f.context, "rejected");
});
test("not-applicable requires independent scoped determination, not candidate declaration", () => {
  const f = fixture();
  const record = { ...unavailable(f), disposition: "not-applicable", reasonCode: "OUT_OF_SCOPE" };
  check(f, record, f.context, "rejected");
  const scopeEvidence = {
    ...f.context.evidence[0]!, kind: "scope-determination" as const, origin: "independent-service" as const,
    sha256: digest({ synthetic: "scope determination" })
  };
  f.context.evidence.push(scopeEvidence);
  const determination = {
    candidateAlias: f.record.candidateAlias, criterionId: f.record.criterionId, artifactDigest: f.record.artifactDigest,
    id: "synthetic-scope", determinedBy: "independent-scope-controller",
    authorityEvidenceDigest: digest({ synthetic: "scope authority" }), reasonCode: "OUT_OF_SCOPE" as const,
    evidenceHash: scopeEvidence.sha256
  };
  f.context.notApplicable.push(determination);
  check(f, f.record, f.context, "rejected");
  check(f, { ...record, evidenceHashes: [scopeEvidence.sha256] });
  check(f, record, f.context, "rejected");
  check(f, { ...record, evidenceHashes: [scopeEvidence.sha256], rating: "met" }, f.context, "rejected");
  const wrong = { ...f.context, notApplicable: [{ ...determination, evidenceHash: f.context.evidence[0]!.sha256 }] };
  check(f, record, wrong, "rejected");
  const duplicated = { ...f.context, notApplicable: [determination, determination] };
  check(f, record, duplicated, "rejected");
  addFailure(f);
  check(f, { ...record, evidenceHashes: [scopeEvidence.sha256], hardFailureCodes: ["FALSE_CONFIRMATION"] }, f.context, "rejected");
});
test("context rejects invalid hard failure references and criterion-policy conflicts", () => {
  const f = fixture(); addFailure(f);
  check(f, f.record, { ...f.context, hardFailures: [{ ...f.context.hardFailures[0], evidenceHashes: ["0".repeat(64)] }] }, "rejected");
  check(f, f.record, { ...f.context, hardFailures: [{ ...f.context.hardFailures[0], code: "MISLEADING_CONSENT" }] }, "rejected");
  check(f, f.record, { ...f.context, hardFailures: [...f.context.hardFailures, ...f.context.hardFailures] }, "rejected");
});
test("blind packet structurally excludes methods, host, grant/config, logs, original identity and prior ratings", () => {
  const f = fixture();
  const result = prepareBlindReviewPacket(f.rubric, f.context, f.record.candidateAlias, f.record.criterionId);
  assert.equal(result.status, "schema-valid"); assert.equal(result.blindingAchieved, false);
  assert.ok(result.packet);
  assert.deepEqual(Object.keys(result.packet).sort(),
    ["schemaVersion", "candidateAlias", "criterionId", "artifactDigest", "rubricDigest", "evidence"].sort());
  assert.ok(!JSON.stringify(result.packet).includes("synthetic-reviewer"));
  for (const field of ["method", "host", "developmentLogs", "priorRatings", "reviewerConfiguration"]) {
    assert.equal(BlindReviewPacket.safeParse({ ...result.packet, [field]: "PRIVATE_CANARY" }).success, false);
  }
  assert.equal(BlindReviewPacket.safeParse({ ...result.packet, evidence: [{ ...result.packet.evidence[0], method: "PRIVATE_CANARY" }] }).success, false);
  assert.equal(prepareBlindReviewPacket(f.rubric, f.context, "baseline", "R01").status, "rejected");
  assert.equal(prepareBlindReviewPacket(f.rubric, f.context, f.record.candidateAlias, "R99").status, "rejected");
  assert.equal(prepareBlindReviewPacket(f.rubric, { ...f.context, method: "PRIVATE_CANARY" }, f.record.candidateAlias, "R01").packet, null);
  assert.equal(prepareBlindReviewPacket(f.rubric, { ...f.context, evidence: [] }, f.record.candidateAlias, "R01").packet, null);
});
test("model configuration is a separately bound contract, not an invoked or approved judge", () => {
  const f = fixture();
  f.context.reviewerConfiguration = {
    kind: "model", reviewerId: "synthetic-reviewer", protocolDigest: digest({ synthetic: "protocol" }),
    settings: { id: "synthetic-contract-model-v1", reasoning: "low", context: "default" },
    budgetDigest: digest({ synthetic: "separate budget contract" })
  };
  f.context.reviewerGrants[0]!.configurationDigest = digest(f.context.reviewerConfiguration);
  check(f);
  check(f, f.record, { ...f.context, reviewerConfiguration: { ...f.context.reviewerConfiguration, budgetDigest: null } }, "rejected");
});
test("changing a draft anchor invalidates the old controller digest without freezing or approving anything", () => {
  const f = fixture();
  f.rubric.criteria[0]!.anchors.met = "A different original draft anchor.";
  assert.deepEqual(check(f, f.record, f.context, "rejected").errorCodes, ["REVIEW_CONTEXT_INVALID"]);
  assert.equal(f.rubric.completedReviews, 0); assert.equal(f.rubric.freezeStatus, "draft-no-approved-manifest");
});
