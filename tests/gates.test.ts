import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectManifest } from "../packages/lab/src/manifest.js";
import { runCommand } from "../packages/lab/src/runner.js";
import { BudgetLedger } from "../packages/lab/src/budget.js";
import { approvedUnitManifest, clock, limits, sandbox } from "./helpers.js";

test("published draft cannot authorize any measured run", () => {
  const draft: unknown = JSON.parse(readFileSync("experiment/manifest.draft.json", "utf8"));
  assert.equal(inspectManifest(draft, clock).ready, false);
  assert.throws(() => runCommand("measured", draft), /MANIFEST_REJECTED/);
  assert.equal(runCommand("preflight", draft).status, "not-run");
});
test("complete unit manifest validates only within its approval interval", () => {
  const manifest = approvedUnitManifest();
  assert.equal(inspectManifest(manifest, clock).ready, true);
  assert.equal(inspectManifest(manifest, "1999-01-01T00:00:00.000Z").ready, false);
  assert.equal(inspectManifest(manifest, manifest.approval.expiresAt).ready, false);
});
test("stale approval and automatic model selection are rejected", () => {
  const manifest = approvedUnitManifest();
  manifest.runtime.model.id = "auto";
  assert.equal(inspectManifest(manifest, clock).ready, false);
  const changed = approvedUnitManifest();
  changed.limits.total.requests++;
  assert.equal(inspectManifest(changed, clock).ready, false);
});
test("contaminated baseline and fake common-host gstack are rejected", () => {
  const manifest = approvedUnitManifest();
  manifest.arms.baseline.methodPackageCount = 1;
  assert.equal(inspectManifest(manifest, clock).ready, false);
  const native = approvedUnitManifest();
  native.arms.gstack.host = "copilot";
  assert.equal(inspectManifest(native, clock).ready, false);
});
test("even a fully formed current manifest cannot activate unverified live executor", () => {
  const manifest = approvedUnitManifest();
  assert.ok(manifest.approval.approvedBy);
  // The schema example is a test assertion, never a real approval.
  const future = { ...manifest, approval: {
    ...manifest.approval, approvedAt: "2000-01-01T00:00:00.000Z", expiresAt: "2999-01-01T00:00:00.000Z"
  } };
  assert.throws(() => runCommand("live", future), /LIVE_EXECUTION_DISABLED/);
});
const reservation = {
  requestId: "unit-r1", arm: "baseline", episodeId: "unit-episode",
  phase: "smoke", maxOutputTokens: 4, at: clock
};
test("numeric limits must be positive, finite and integral for counts", (t) => {
  const space = sandbox(t);
  assert.throws(() => new BudgetLedger(space.path, { ...limits(), maxOutputTokensPerCall: 0 }, clock));
  assert.throws(() => new BudgetLedger(space.path, { ...limits(), maxAttemptsPerEpisode: 1.1 }, clock));
});
test("smoke, repeat, retry and final reservations share persistent caps", (t) => {
  const space = sandbox(t);
  let budget = space.keep(new BudgetLedger(space.path, limits(), clock));
  budget.reserve(reservation);
  budget.close();
  budget = space.keep(new BudgetLedger(space.path, limits(), clock));
  budget.reserve({ ...reservation, requestId: "unit-r2", phase: "retry" });
  assert.throws(() => budget.reserve({ ...reservation, requestId: "unit-r3", phase: "repeat" }), /attempt cap/);
  budget.reserve({ ...reservation, requestId: "unit-r4", episodeId: "other", phase: "final" });
  assert.throws(() => budget.reserve({ ...reservation, requestId: "unit-r5", episodeId: "new" }), /arm budget/);
  assert.equal(budget.summary().requests, 3);
  assert.equal(budget.summary().aiCredits, null);
});
test("total budget is shared across arms, including simultaneous connections", (t) => {
  const space = sandbox(t);
  const a = space.keep(new BudgetLedger(space.path, limits(), clock));
  const b = space.keep(new BudgetLedger(space.path, limits(), clock));
  for (let i = 0; i < 5; i++) {
    (i % 2 ? a : b).reserve({ ...reservation, requestId: `unit-${i}`, episodeId: `episode-${i}`, arm: i < 3 ? "hve" : "gstack" });
  }
  assert.throws(() => a.reserve({ ...reservation, requestId: "over" }), /total budget/);
  assert.equal(a.summary().requests, 5);
});
test("duplicate reservations, deadline and oversized calls cannot consume extra slots", (t) => {
  const space = sandbox(t);
  const budget = space.keep(new BudgetLedger(space.path, limits(), clock));
  budget.reserve(reservation);
  assert.throws(() => budget.reserve(reservation));
  assert.throws(() => budget.reserve({ ...reservation, requestId: "over", maxOutputTokens: 5 }), /Per-call/);
  assert.throws(() => budget.reserve({ ...reservation, requestId: "late", at: "2000-01-01T00:00:01.000Z" }), /deadline/);
  assert.equal(budget.summary().requests, 1);
});
test("missing usage durably blocks further calls instead of being free", (t) => {
  const space = sandbox(t);
  let budget = space.keep(new BudgetLedger(space.path, limits(), clock));
  budget.reserve(reservation);
  assert.throws(() => budget.settle({ requestId: "unit-r1", outputTokens: null, aiCredits: null }), /Unknown usage/);
  budget.close();
  budget = space.keep(new BudgetLedger(space.path, limits(), clock));
  assert.throws(() => budget.reserve({ ...reservation, requestId: "unit-r2" }), /blocked/);
  assert.equal(budget.summary().aiCredits, null);
});
test("known credits are separate from currency; provider token overruns are errors", (t) => {
  const space = sandbox(t);
  const budget = space.keep(new BudgetLedger(space.path, limits(), clock));
  budget.reserve(reservation);
  budget.settle({ requestId: "unit-r1", outputTokens: 2, aiCredits: 2 });
  assert.equal(budget.summary().aiCredits, 2);
  assert.equal(budget.summary().pricingCurrency, null);
  assert.throws(() => budget.reserve({ ...reservation, requestId: "unit-r2" }), /arm budget/);
  assert.throws(() => budget.settle({ requestId: "unit-r1", outputTokens: 2, aiCredits: 0 }), /already settled/);
  const overrun = space.keep(new BudgetLedger(`${space.path}.overrun`, limits(), clock));
  overrun.reserve(reservation);
  assert.throws(() => overrun.settle({ requestId: "unit-r1", outputTokens: 5, aiCredits: 0.1 }), /exceeded reserved/);
  assert.throws(() => overrun.reserve({ ...reservation, requestId: "unit-r2" }), /blocked/);
});
test("restart cannot silently change approved limits", (t) => {
  const space = sandbox(t);
  const budget = space.keep(new BudgetLedger(space.path, limits(), clock));
  budget.close();
  assert.throws(() => new BudgetLedger(space.path, { ...limits(), maxAttemptsPerEpisode: 9 }, clock), /configuration changed/);
});
