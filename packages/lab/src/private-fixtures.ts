import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { Count, Id, IdentityClaims, Money, Resource, Timestamp } from "../../contracts/src/index.js";
import { Oracle } from "./evaluator.js";
import { Fault } from "./dataset.js";

const Text = z.string().min(1);
export const PrivateCase = z.strictObject({
  id: Id, caseId: Id, title: Text, omitResourceIds: z.array(Id),
  faults: z.array(Fault), episode: z.array(Text).min(1),
  oracle: Oracle, additionalAssertions: z.array(Text)
});
export const PrivateBundle = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal("private-synthetic-holdout-preparation"),
  executionStatus: z.literal("not-run"), repetitionsPerScenario: z.literal(3),
  clock: Timestamp, policyVersion: Id,
  publication: Text, adapterStatus: Text, identifierContract: Text,
  policy: z.strictObject({
    replacementAlwaysRequiresApproval: z.boolean(), maximumDistanceMetres: Count,
    requiredClass: Text, requiredRoomCategory: Text, requiredOccupancy: Count.positive(),
    currency: Money.shape.currency, syntheticExcessCostThresholdMinorUnits: Count,
    arrivalWindowHours: Count.positive(), supplierLookbackDays: Count.positive(),
    boundaryConvention: Text, supplierCommunicationDefault: Text
  }),
  actors: z.array(IdentityClaims).min(1), resources: z.array(Resource).min(1),
  cases: z.array(PrivateCase).length(12),
  verificationBoundary: z.strictObject({
    schemaCompatibility: Text, additionalAssertions: Text, fixturePreparationIsNot: z.array(Text).min(1)
  })
});

export function validatePrivateBundle(input: unknown) {
  const result = PrivateBundle.safeParse(input);
  if (!result.success) return {
    counts: { schemaIssues: result.error.issues.length },
    errorCodes: ["FIXTURE_SCHEMA_INVALID"], coverageCodes: ["NOT_EXECUTED"]
  };
  const bundle = result.data;
  const errors = new Set<string>();
  const resources = bundle.resources;
  const unique = (keys: string[], code: string) => {
    if (new Set(keys).size !== keys.length) errors.add(code);
  };
  const key = (tenant: string, id: string) => JSON.stringify([tenant, id]);
  const evidence = (tenant: string, id: string, omissions: string[] = []) =>
    resources.some((resource) => resource.kind === "evidence" && resource.data.tenantId === tenant &&
      resource.data.id === id && !omissions.includes(id));
  unique(bundle.cases.map((item) => item.id), "DUPLICATE_CASE_ID");
  unique(bundle.cases.map((item) => item.caseId), "DUPLICATE_CASE_REFERENCE");
  unique(resources.map((item) => key(item.data.tenantId, item.data.id)), "AMBIGUOUS_RESOURCE_ID");
  unique(bundle.actors.map((actor) => key(actor.tenantId, actor.actorId)), "DUPLICATE_ACTOR");
  unique(bundle.actors.map((actor) => actor.sessionId), "DUPLICATE_SESSION");
  for (const resource of resources) {
    if ("evidenceIds" in resource.data && resource.data.evidenceIds.some((id) => !evidence(resource.data.tenantId, id))) {
      errors.add("RESOURCE_EVIDENCE_REFERENCE_INVALID");
    }
    if ("hotelId" in resource.data) {
      const { hotelId, tenantId } = resource.data;
      if (!resources.some((item) => item.kind === "hotel" && item.data.id === hotelId && item.data.tenantId === tenantId)) {
        errors.add("RESOURCE_HOTEL_REFERENCE_INVALID");
      }
    }
  }
  let textualSteps = 0;
  let unsupportedAssertions = 0;
  for (const item of bundle.cases) {
    textualSteps += item.episode.length;
    unsupportedAssertions += item.additionalAssertions.length;
    if (item.oracle.caseId !== item.caseId) errors.add("ORACLE_CASE_MISMATCH");
    unique(item.faults.map((fault) => `${fault.operation}:${fault.call}`), "DUPLICATE_FAULT_SLOT");
    unique(item.omitResourceIds, "DUPLICATE_OMISSION");
    if (item.omitResourceIds.some((id) => !resources.some((resource) =>
      resource.data.id === id && resource.data.tenantId === item.oracle.tenantId))) errors.add("OMISSION_REFERENCE_INVALID");
    if (item.oracle.evidenceIds.some((id) => !evidence(item.oracle.tenantId, id, item.omitResourceIds))) {
      errors.add("ORACLE_EVIDENCE_REFERENCE_INVALID");
    }
    for (const effect of item.oracle.allowedEffects) {
      if (!bundle.actors.some((actor) => actor.actorId === effect.actorId && actor.tenantId === effect.tenantId)) {
        errors.add("EFFECT_ACTOR_REFERENCE_INVALID");
      }
      if (effect.evidenceIds.some((id) => !evidence(effect.tenantId, id, item.omitResourceIds))) {
        errors.add("EFFECT_EVIDENCE_REFERENCE_INVALID");
      }
      if (effect.policyVersion !== bundle.policyVersion) errors.add("EFFECT_POLICY_VERSION_MISMATCH");
    }
    if (item.oracle.requiredBookingTargets.some((id) => item.omitResourceIds.includes(id) ||
      !resources.some((resource) => resource.kind === "hotel" && resource.data.id === id &&
        resource.data.tenantId === item.oracle.tenantId))) errors.add("BOOKING_TARGET_REFERENCE_INVALID");
  }
  return {
    counts: {
      schemaIssues: 0, resources: resources.length, actors: bundle.actors.length,
      cases: bundle.cases.length, repetitions: bundle.repetitionsPerScenario,
      textualSteps, unsupportedAssertions, executedEpisodes: 0
    },
    errorCodes: [...errors].sort(),
    coverageCodes: ["EPISODE_TEXT_NOT_EXECUTABLE", "ADDITIONAL_ASSERTIONS_UNEVALUATED",
      "APPROVAL_BINDING_AND_SEMANTIC_GROUNDING_UNVERIFIED", "SOURCE_AND_ACTION_TARGET_BINDING_UNVERIFIED"]
  };
}

export function validatePrivateFile(path: string, expectedHash?: string) {
  let bytes: Buffer;
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > 8 * 1024 * 1024) {
      return { counts: {}, hash: null, errorCodes: ["FIXTURE_FILE_LIMIT"], coverageCodes: ["NOT_EXECUTED"] };
    }
    bytes = readFileSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      return { counts: {}, hash: null, errorCodes: ["FIXTURE_READ_FAILED"], coverageCodes: ["NOT_EXECUTED"] };
    }
    throw error;
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (expectedHash !== undefined && hash !== expectedHash) {
    return { counts: {}, hash, errorCodes: ["FIXTURE_HASH_MISMATCH"], coverageCodes: ["NOT_EXECUTED"] };
  }
  let input: unknown;
  try { input = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch (error) {
    if (error instanceof SyntaxError) return {
      counts: {}, hash, errorCodes: ["FIXTURE_JSON_INVALID"], coverageCodes: ["NOT_EXECUTED"]
    };
    throw error;
  }
  return { ...validatePrivateBundle(input), hash };
}
