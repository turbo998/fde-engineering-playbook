import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { Count, Id, IdentityClaims, Money, Resource, Timestamp } from "../../contracts/src/index.js";
import { Oracle } from "./evaluator.js";
import { Fault } from "./dataset.js";
import { digest } from "./encoding.js";
import { PrivateSemanticCompanion } from "./semantic-episode-schema.js";

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

export function semanticCompanionSchemaDigest() {
  return digest(z.toJSONSchema(PrivateSemanticCompanion));
}

export function validateSemanticCompanion(sourceInput: unknown, companionInput: unknown, sourceSHA256: string) {
  const source = PrivateBundle.safeParse(sourceInput);
  const parsed = PrivateSemanticCompanion.safeParse(companionInput);
  if (!source.success || !parsed.success) return {
    errorCodes: ["COMPANION_SCHEMA_INVALID"], counts: { executedEpisodes: 0 }
  };
  if (validatePrivateBundle(source.data).errorCodes.length) return {
    errorCodes: ["COMPANION_SOURCE_INVALID"], counts: { executedEpisodes: 0 }
  };
  const companion = parsed.data;
  const errors = new Set<string>();
  if (companion.sourceSHA256 !== sourceSHA256) errors.add("COMPANION_SOURCE_HASH_MISMATCH");
  if (companion.schemaDigest !== semanticCompanionSchemaDigest()) errors.add("COMPANION_SCHEMA_DIGEST_MISMATCH");
  const coverage = {
    "implemented-machine-rule": 0, "prepared-unexecuted-integration": 0,
    "rubric-required": 0, unsupported: 0
  };
  let sourceSteps = 0;
  let typedSteps = 0;
  let assertions = 0;
  for (const entry of companion.cases) {
    const original = source.data.cases.find((c) => c.id === entry.script.id);
    if (!original) { errors.add("COMPANION_CASE_MISMATCH"); continue; }
    const script = entry.script;
    if (script.oracle.tenantId !== original.oracle.tenantId || script.oracle.caseId !== original.caseId ||
        digest(script.oracle.allowedStatuses) !== digest(original.oracle.allowedStatuses) ||
        digest(script.oracle.requiredEffectKeys) !== digest(original.oracle.requiredEffectKeys) ||
        digest(script.oracle.requiredBookingTargets) !== digest(original.oracle.requiredBookingTargets)) {
      errors.add("COMPANION_ORACLE_SCOPE_MISMATCH");
    }
    const expectedResources = source.data.resources.filter((r) =>
      r.data.tenantId === original.oracle.tenantId && !original.omitResourceIds.includes(r.data.id));
    if (digest(script.dataset.fixtures.map((f) => f.resource)) !== digest(expectedResources) ||
        digest(script.oracle.fixtures) !== digest(script.dataset.fixtures) ||
        digest(script.dataset.faults) !== digest(original.faults) ||
        script.dataset.clock !== source.data.clock || script.dataset.policyVersion !== source.data.policyVersion ||
        digest(script.oracle.actors) !== digest(source.data.actors)) errors.add("COMPANION_TRUST_INPUT_MISMATCH");
    if (digest(script.oracle.policy) !== digest({
      arrivalWindowHours: source.data.policy.arrivalWindowHours,
      supplierLookbackDays: source.data.policy.supplierLookbackDays,
      maximumDistanceMetres: source.data.policy.maximumDistanceMetres,
      requiredClass: source.data.policy.requiredClass,
      requiredRoomCategory: source.data.policy.requiredRoomCategory,
      requiredOccupancy: source.data.policy.requiredOccupancy
    })) errors.add("COMPANION_POLICY_MISMATCH");
    if (script.sourceStepMappings.length !== original.episode.length ||
        script.sourceStepMappings.some((m) => digest(original.episode[m.sourceIndex]) !== m.sourceDigest) ||
        entry.assertions.length !== original.additionalAssertions.length ||
        entry.assertions.some((a) => digest(original.additionalAssertions[a.sourceIndex]) !== a.sourceDigest)) {
      errors.add("COMPANION_SOURCE_MAPPING_MISMATCH");
    }
    sourceSteps += script.sourceStepMappings.length;
    typedSteps += script.steps.length;
    assertions += entry.assertions.length;
    for (const assertion of entry.assertions) coverage[assertion.category]++;
  }
  return {
    errorCodes: [...errors].sort(),
    counts: { cases: companion.cases.length, sourceSteps, typedSteps, assertions, executedEpisodes: 0 },
    coverage,
    sourceSHA256: companion.sourceSHA256, schemaDigest: companion.schemaDigest,
    companionDigest: digest(companion), scriptDigests: companion.cases.map((c) => c.scriptDigest)
  };
}

export function validateSemanticCompanionFiles(sourcePath: string, companionPath: string, expectedSourceHash: string) {
  const read = (path: string) => {
    let bytes: Buffer;
    try {
      const info = statSync(path);
      if (!info.isFile() || info.size > 8 * 1024 * 1024) return { error: "PREPARATION_FILE_LIMIT" } as const;
      bytes = readFileSync(path);
    } catch (error) {
      if (error instanceof Error && "code" in error) return { error: "PREPARATION_READ_FAILED" } as const;
      throw error;
    }
    try {
      return { input: JSON.parse(bytes.toString("utf8")) as unknown,
        hash: createHash("sha256").update(bytes).digest("hex") };
    } catch (error) {
      if (error instanceof SyntaxError) return { error: "PREPARATION_JSON_INVALID" } as const;
      throw error;
    }
  };
  const source = read(sourcePath);
  const companion = read(companionPath);
  if ("error" in source || "error" in companion) return {
    counts: { executedEpisodes: 0 }, errorCodes: ["error" in source ? source.error : companion.error]
  };
  if (source.hash !== expectedSourceHash) return {
    counts: { executedEpisodes: 0 }, errorCodes: ["COMPANION_SOURCE_HASH_MISMATCH"]
  };
  return { ...validateSemanticCompanion(source.input, companion.input, source.hash), companionSHA256: companion.hash };
}
