import { z } from "zod";
import { Count, Id, Timestamp } from "../../contracts/src/index.js";
import { digest } from "./encoding.js";

export const Arm = z.enum(["baseline", "hve", "superpowers", "gstack"]);
const Sha = z.string().regex(/^[a-f0-9]{40}$/);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const ExactModel = z.string().min(2).max(160).refine(
  (value) => !/(^auto$|latest|placeholder|pending|unknown|tbd|[<>])/i.test(value) && value.trim() === value,
  "An exact, approved model ID is required"
);
export const ModelSettings = z.strictObject({
  id: ExactModel,
  reasoning: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
  context: z.enum(["default", "long_context"])
});
const Cap = z.strictObject({
  requests: Count.positive(),
  reservedOutputTokens: Count.positive(),
  aiCredits: z.number().finite().positive()
});
export const Limits = z.strictObject({
  perArm: z.strictObject({ baseline: Cap, hve: Cap, superpowers: Cap, gstack: Cap }),
  total: Cap,
  maxOutputTokensPerCall: Count.positive(),
  maxAttemptsPerEpisode: Count.positive(),
  maxElapsedMs: Count.positive(),
  softCreditOverrunAcknowledged: z.literal(true)
});
const VerifiedEvidence = z.strictObject({ status: z.literal("verified"), evidenceDigest: Hash });
const MethodArm = z.strictObject({
  host: z.enum(["copilot", "codex"]),
  hostVersion: z.string().min(1),
  model: ModelSettings,
  methodRevision: Sha.nullable(),
  methodPackageCount: Count,
  compatibility: VerifiedEvidence,
  toolInventoryDigest: Hash
});
export const Manifest = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.literal("approved"),
  experimentId: Id,
  seedCommit: Sha,
  scenarioManifestDigest: Hash,
  holdoutDigest: Hash,
  rubricDigest: Hash,
  scenarioFamilies: z.literal(12),
  repeats: z.literal(3),
  order: z.array(Arm).length(4),
  orderSeed: Id,
  arms: z.strictObject({
    baseline: MethodArm, hve: MethodArm, superpowers: MethodArm, gstack: MethodArm
  }),
  runtime: z.strictObject({
    provider: z.literal("copilot-sdk"),
    sdkVersion: z.string().min(1), cliVersion: z.string().min(1),
    model: ModelSettings
  }),
  reviewer: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("human"), reviewerId: Id }),
    z.strictObject({ kind: z.literal("model"), model: ModelSettings })
  ]),
  isolation: z.strictObject({
    cleanHome: VerifiedEvidence, inventories: VerifiedEvidence,
    canary: VerifiedEvidence, processRestrictions: VerifiedEvidence,
    seedOnly: VerifiedEvidence, holdoutSealed: VerifiedEvidence
  }),
  limits: Limits,
  approval: z.strictObject({
    approvedBy: Id, approvedAt: Timestamp, expiresAt: Timestamp,
    evidenceDigest: Hash, configurationDigest: Hash
  })
}).superRefine((m, ctx) => {
  const problem = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(m.order).size !== 4) problem("Each arm must occur once");
  if (m.arms.baseline.methodPackageCount !== 0 || m.arms.baseline.methodRevision !== null) {
    problem("Baseline requires zero method packages");
  }
  for (const name of ["hve", "superpowers", "gstack"] as const) {
    if (m.arms[name].methodPackageCount !== 1 || m.arms[name].methodRevision === null) {
      problem(`${name} requires exactly its pinned method package`);
    }
  }
  if (m.arms.gstack.host !== "codex") problem("gstack is a separate native Codex observational arm");
  for (const name of ["baseline", "hve", "superpowers"] as const) {
    if (m.arms[name].host !== "copilot") problem("Controlled arms require Copilot");
    if (digest(m.arms[name].model) !== digest(m.arms.baseline.model) ||
        m.arms[name].hostVersion !== m.arms.baseline.hostVersion ||
        m.arms[name].toolInventoryDigest !== m.arms.baseline.toolInventoryDigest) {
      problem("Controlled host, model, settings and tool access must match");
    }
  }
  const { approval, ...configuration } = m;
  if (digest(configuration) !== approval.configurationDigest) problem("Approval does not bind this configuration");
  if (Date.parse(approval.approvedAt) >= Date.parse(approval.expiresAt)) problem("Invalid approval interval");
});
export type Arm = z.infer<typeof Arm>;
export type Limits = z.infer<typeof Limits>;
export type Manifest = z.infer<typeof Manifest>;

export function inspectManifest(input: unknown, now: string) {
  Timestamp.parse(now);
  const parsed = Manifest.safeParse(input);
  if (!parsed.success) return {
    ready: false as const,
    reasons: parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
  };
  const reasons: string[] = [];
  if (Date.parse(now) < Date.parse(parsed.data.approval.approvedAt)) reasons.push("Approval is not yet effective");
  if (Date.parse(now) >= Date.parse(parsed.data.approval.expiresAt)) reasons.push("Approval has expired");
  return { ready: reasons.length === 0, reasons };
}

export function assertExecutionDisabled(): never {
  throw new Error("LIVE_EXECUTION_DISABLED: no verified per-model-call admission or approved execution adapter; benchmark remains not-run");
}
