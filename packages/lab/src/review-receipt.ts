import { z } from "zod";
import { Id, Timestamp } from "../../contracts/src/index.js";
import { digest } from "./encoding.js";
import { ModelSettings } from "./manifest.js";
import { CriterionId, EvidenceKind, HardFailureCode, QualityRubric, Rating } from "./quality-rubric.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const CandidateAlias = z.string().regex(/^candidate-[a-f0-9]{16}$/);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const Hashes = z.array(Hash).max(32).refine(unique);
const Scope = {
  candidateAlias: CandidateAlias, criterionId: CriterionId, artifactDigest: Hash
};
const ReviewerConfiguration = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human"), reviewerId: Id, protocolDigest: Hash }),
  z.strictObject({
    kind: z.literal("model"), reviewerId: Id, protocolDigest: Hash,
    settings: ModelSettings, budgetDigest: Hash
  })
]);
const Evidence = z.strictObject({
  ...Scope, sha256: Hash, kind: EvidenceKind,
  origin: z.enum(["controller-capture", "independent-service"])
}).refine((item) => ["rendered-artifact", "browser-trace"].includes(item.kind) ||
  item.origin === "independent-service");
const Grant = z.strictObject({
  ...Scope, id: Id, reviewerId: Id, rubricDigest: Hash, configurationDigest: Hash,
  authorityEvidenceDigest: Hash, status: z.enum(["approved", "revoked"]),
  validFrom: Timestamp, expiresAt: Timestamp
}).refine((grant) => Date.parse(grant.validFrom) < Date.parse(grant.expiresAt));

// This is a controller-held registry snapshot, not data supplied by a candidate or receipt.
export const ReviewContext = z.strictObject({
  schemaVersion: z.literal(1), rubricDigest: Hash,
  reviewerConfiguration: ReviewerConfiguration.nullable(),
  candidates: z.array(z.strictObject({ candidateAlias: CandidateAlias, artifactDigest: Hash })).max(1_000)
    .refine((items) => unique(items.map((item) => item.candidateAlias))),
  reviewerGrants: z.array(Grant).max(6_000).refine((items) => unique(items.map((item) => item.id))),
  evidence: z.array(Evidence).max(32_000).refine((items) => unique(items.map((item) => item.sha256))),
  notApplicable: z.array(z.strictObject({
    ...Scope, id: Id, determinedBy: Id, authorityEvidenceDigest: Hash,
    reasonCode: z.literal("OUT_OF_SCOPE"), evidenceHash: Hash
  })).max(6_000).refine((items) => unique(items.map((item) => item.id)) &&
    unique(items.map((item) => `${item.candidateAlias}:${item.criterionId}`))),
  hardFailures: z.array(z.strictObject({
    ...Scope, code: HardFailureCode, evidenceHashes: Hashes.refine((items) => items.length > 0)
  })).max(30_000).refine((items) =>
    unique(items.map((item) => `${item.candidateAlias}:${item.criterionId}:${item.code}`)))
});
export type ReviewContext = z.infer<typeof ReviewContext>;
export const ReviewReceipt = z.strictObject({
  ...Scope, rubricDigest: Hash,
  disposition: z.enum(["reviewed", "unavailable", "not-applicable"]),
  rating: Rating.nullable(),
  reasonCode: z.enum(["REVIEWER_UNAVAILABLE", "EVIDENCE_UNAVAILABLE", "REVIEW_NOT_PERFORMED", "OUT_OF_SCOPE"]).nullable(),
  reviewerGrantId: Id.nullable(), evidenceHashes: Hashes,
  justification: z.string().trim().min(1).max(800).nullable(),
  hardFailureCodes: z.array(HardFailureCode).max(5).refine(unique)
});
export type ReviewReceipt = z.infer<typeof ReviewReceipt>;

export const BlindReviewPacket = z.strictObject({
  schemaVersion: z.literal(1), ...Scope, rubricDigest: Hash,
  evidence: z.array(z.strictObject({ kind: EvidenceKind, sha256: Hash })).max(32)
    .refine((items) => unique(items.map((item) => item.sha256)))
});
type ScopeValue = z.infer<typeof Evidence>;
function sameScope(left: z.infer<typeof ReviewReceipt>, right: Pick<ScopeValue, keyof typeof Scope>): boolean {
  return left.candidateAlias === right.candidateAlias && left.criterionId === right.criterionId &&
    left.artifactDigest === right.artifactDigest;
}

function inspectContext(rubricInput: unknown, contextInput: unknown) {
  const rubric = QualityRubric.safeParse(rubricInput);
  if (!rubric.success) return { error: "QUALITY_RUBRIC_INVALID" } as const;
  const context = ReviewContext.safeParse(contextInput);
  if (!context.success || context.data.rubricDigest !== digest(rubric.data)) {
    return { error: "REVIEW_CONTEXT_INVALID" } as const;
  }
  const registry = context.data;
  const scoped = (item: Pick<ScopeValue, keyof typeof Scope>) => registry.candidates.some((candidate) =>
    candidate.candidateAlias === item.candidateAlias && candidate.artifactDigest === item.artifactDigest);
  const evidenceFor = (hash: string, item: Pick<ScopeValue, keyof typeof Scope>) => registry.evidence.find((evidence) =>
    evidence.sha256 === hash && evidence.candidateAlias === item.candidateAlias &&
    evidence.criterionId === item.criterionId && evidence.artifactDigest === item.artifactDigest);
  if (registry.evidence.some((item) => !scoped(item)) ||
      registry.reviewerGrants.some((grant) => !scoped(grant) || grant.rubricDigest !== registry.rubricDigest ||
        registry.reviewerConfiguration === null || grant.reviewerId !== registry.reviewerConfiguration.reviewerId ||
        grant.configurationDigest !== digest(registry.reviewerConfiguration)) ||
      registry.notApplicable.some((item) => !scoped(item) ||
        evidenceFor(item.evidenceHash, item)?.kind !== "scope-determination") ||
      registry.hardFailures.some((item) => !scoped(item) ||
        !rubric.data.criteria.find((criterion) => criterion.id === item.criterionId)?.hardFailureCodes.includes(item.code) ||
        item.evidenceHashes.some((hash) => !evidenceFor(hash, item)))) {
    return { error: "REVIEW_CONTEXT_INVALID" } as const;
  }
  return { rubric: rubric.data, registry } as const;
}

function validationResult(errorCodes: string[]) {
  return {
    kind: "review-receipt-contract-validation" as const,
    status: errorCodes.length ? "rejected" as const : "schema-valid" as const,
    reviewPerformanceVerified: false as const, factualCorrectnessVerified: false as const,
    reviewerAuthorityAuthenticated: false as const, blindingAchieved: false as const,
    benchmarkResultCreated: false as const, errorCodes: [...new Set(errorCodes)].sort()
  };
}

export function validateReviewReceipt(rubricInput: unknown, receiptInput: unknown, controllerContext: unknown, now: unknown) {
  const context = inspectContext(rubricInput, controllerContext);
  if ("error" in context) return validationResult([context.error]);
  const parsed = ReviewReceipt.safeParse(receiptInput);
  if (!parsed.success) return validationResult(["REVIEW_RECEIPT_INVALID"]);
  const time = Timestamp.safeParse(now);
  if (!time.success) return validationResult(["REVIEW_TIME_INVALID"]);
  const record = parsed.data; const { registry, rubric } = context;
  const errors: string[] = [];
  if (record.rubricDigest !== registry.rubricDigest || !registry.candidates.some((candidate) =>
    candidate.candidateAlias === record.candidateAlias && candidate.artifactDigest === record.artifactDigest)) {
    errors.push("REVIEW_SCOPE_MISMATCH");
  }
  const evidence = record.evidenceHashes.map((hash) => registry.evidence.find((item) =>
    item.sha256 === hash && sameScope(record, item)));
  if (evidence.some((item) => !item)) errors.push("REVIEW_EVIDENCE_UNAVAILABLE");
  const failures = registry.hardFailures.filter((item) => sameScope(record, item));
  if (digest([...record.hardFailureCodes].sort()) !== digest(failures.map((item) => item.code).sort())) {
    errors.push("REVIEW_HARD_FAILURE_MISMATCH");
  }
  if (record.disposition === "reviewed") {
    if (registry.notApplicable.some((item) => sameScope(record, item))) errors.push("REVIEW_APPLICABILITY_CONFLICT");
    if (record.rating === null || record.reasonCode !== null || record.justification === null) {
      errors.push("REVIEWED_RESULT_INVALID");
    }
    const grant = registry.reviewerGrants.find((item) => item.id === record.reviewerGrantId);
    if (!grant || !sameScope(record, grant) || grant.status !== "approved" ||
        Date.parse(time.data) < Date.parse(grant.validFrom) || Date.parse(time.data) >= Date.parse(grant.expiresAt)) {
      errors.push("REVIEWER_GRANT_UNAVAILABLE");
    }
    const criterion = rubric.criteria.find((item) => item.id === record.criterionId);
    if (criterion?.requiredEvidence.some((kind) => !evidence.some((item) => item?.kind === kind)) ||
        failures.some((item) => item.evidenceHashes.some((hash) => !record.evidenceHashes.includes(hash)))) {
      errors.push("REVIEW_EVIDENCE_UNAVAILABLE");
    }
    if (failures.length && record.rating !== "not-met") errors.push("REVIEW_HARD_FAILURE_RATING_CONFLICT");
  } else {
    if (record.rating !== null || record.reviewerGrantId !== null || record.justification !== null ||
        record.reasonCode === null) errors.push("UNREVIEWED_RESULT_INVALID");
    if (record.disposition === "not-applicable") {
      const determination = registry.notApplicable.find((item) => sameScope(record, item));
      if (!determination || record.reasonCode !== determination.reasonCode ||
          !record.evidenceHashes.includes(determination.evidenceHash) || failures.length) {
        errors.push("REVIEW_APPLICABILITY_UNVERIFIED");
      }
    } else if (record.reasonCode === "OUT_OF_SCOPE") errors.push("UNREVIEWED_RESULT_INVALID");
  }
  return validationResult(errors);
}

export function prepareBlindReviewPacket(rubricInput: unknown, controllerContext: unknown,
  candidateInput: unknown, criterionInput: unknown) {
  const context = inspectContext(rubricInput, controllerContext);
  if ("error" in context) return { ...validationResult([context.error]), packet: null };
  const alias = CandidateAlias.safeParse(candidateInput); const criterion = CriterionId.safeParse(criterionInput);
  const candidate = alias.success ? context.registry.candidates.find((item) => item.candidateAlias === alias.data) : undefined;
  if (!candidate || !criterion.success) return { ...validationResult(["REVIEW_SCOPE_MISMATCH"]), packet: null };
  const evidence = context.registry.evidence.filter((item) =>
    item.candidateAlias === candidate.candidateAlias && item.criterionId === criterion.data &&
    item.artifactDigest === candidate.artifactDigest);
  const required = context.rubric.criteria.find((item) => item.id === criterion.data)?.requiredEvidence;
  if (!required || required.some((kind) => !evidence.some((item) => item.kind === kind))) {
    return { ...validationResult(["REVIEW_EVIDENCE_UNAVAILABLE"]), packet: null };
  }
  const parsed = BlindReviewPacket.safeParse({
    schemaVersion: 1, ...candidate, criterionId: criterion.data, rubricDigest: context.registry.rubricDigest,
    evidence: evidence.map((item) => ({ kind: item.kind, sha256: item.sha256 }))
  });
  if (!parsed.success) return { ...validationResult(["REVIEW_PACKET_INVALID"]), packet: null };
  return { ...validationResult([]), packet: parsed.data };
}
