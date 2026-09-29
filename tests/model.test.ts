import test from "node:test";
import assert from "node:assert/strict";
import { BlockedCopilotTransport, copilotSessionConfig, exerciseOfflineSdkProtocol } from "../packages/lab/src/model.js";
import type { OfflineSdkDouble } from "../packages/lab/src/model.js";

const request = {
  requestId: "unit-request", settings: { id: "unit-model", reasoning: "low", context: "default" },
  prompt: "Generic protocol unit input, not a business workflow", maxOutputTokens: 4, timeoutMs: 100
};
function offlineDouble(options: { events?: unknown[]; content?: string; fail?: boolean; cleanupFail?: boolean } = {}) {
  const calls: string[] = [];
  let listener: (event: unknown) => void = () => { throw new Error("Listener was not registered"); };
  const double: OfflineSdkDouble = {
    kind: "offline-test-double",
    async createSession(config) {
      calls.push("create");
      assert.equal(config.model, "unit-model");
      assert.deepEqual(config.availableTools, []);
      return {
        onUsage(fn) { listener = fn; return () => { calls.push("unsubscribe"); }; },
        async send(_prompt, timeout) {
          assert.equal(timeout, 100);
          calls.push("send");
          if (options.fail) throw new Error("unit-provider-failure");
          for (const event of options.events ?? []) listener(event);
          return options.content ?? "unit-reply";
        },
        async abort() { calls.push("abort"); },
        async disconnect() { calls.push("disconnect"); }
      };
    },
    async stop() { calls.push("stop"); return options.cleanupFail ? [new Error("unit-cleanup")] : []; }
  };
  return { double, calls };
}
test("live transport rejects before any SDK lifecycle or network access", async () => {
  await assert.rejects(new BlockedCopilotTransport().generate(request), /LIVE_EXECUTION_DISABLED/);
});
test("session configuration excludes tools, retrieval memory and auto-compaction", () => {
  const config = copilotSessionConfig(request);
  assert.deepEqual(config.availableTools, []);
  assert.deepEqual(config.mcpServers, {});
  assert.equal(config.enableSessionStore, false);
  assert.equal(config.infiniteSessions?.enabled, false);
  assert.equal(config.reasoningSummary, "none");
});
test("unsupported reasoning is rejected without silently substituting settings", () => {
  for (const reasoning of ["none", "minimal"]) {
    assert.throws(() => copilotSessionConfig({ ...request, settings: { ...request.settings, reasoning } }), /SDK_REASONING_UNSUPPORTED/);
  }
});
test("offline protocol responses cannot masquerade as real inference", async () => {
  const { double, calls } = offlineDouble({ events: [{ model: "unit-model", inputTokens: 2, outputTokens: 3, cost: 0.1 }] });
  const result = await exerciseOfflineSdkProtocol(request, double);
  assert.equal(result.kind, "offline-test-double");
  assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3, aiCredits: 0.1, currencyCost: null });
  assert.deepEqual(calls, ["create", "send", "unsubscribe", "disconnect", "stop"]);
});
test("no usage event means unknown, not zero", async () => {
  const { double } = offlineDouble();
  const result = await exerciseOfflineSdkProtocol(request, double);
  assert.equal(result.usage.aiCredits, null);
  assert.equal(result.usage.outputTokens, null);
});
test("multiple usage events aggregate and one missing metric stays unknown", async () => {
  const { double } = offlineDouble({ events: [
    { inputTokens: 2, outputTokens: 1, cost: 0.1 }, { outputTokens: 2, cost: 0.2 }
  ] });
  const result = await exerciseOfflineSdkProtocol(request, double);
  assert.equal(result.usage.inputTokens, null);
  assert.equal(result.usage.outputTokens, 3);
});
test("provider error propagates and triggers abort, disconnect and stop without fallback", async () => {
  const { double, calls } = offlineDouble({ fail: true });
  await assert.rejects(exerciseOfflineSdkProtocol(request, double), AggregateError);
  assert.deepEqual(calls, ["create", "send", "abort", "unsubscribe", "disconnect", "stop"]);
});
test("empty response, wrong model and output overrun fail explicitly", async () => {
  for (const options of [
    { content: "" }, { events: [{ model: "different" }] }, { events: [{ outputTokens: 5 }] }
  ]) {
    await assert.rejects(exerciseOfflineSdkProtocol(request, offlineDouble(options).double), AggregateError);
  }
});
test("cleanup errors cannot produce successful responses", async () => {
  await assert.rejects(exerciseOfflineSdkProtocol(request, offlineDouble({ cleanupFail: true }).double), AggregateError);
});
