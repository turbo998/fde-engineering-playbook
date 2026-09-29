import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Count, Id, Timestamp } from "../../contracts/src/index.js";
import { Arm, Limits } from "./manifest.js";
import { digest } from "./encoding.js";

const Reservation = z.strictObject({
  requestId: Id, arm: Arm, episodeId: Id,
  phase: z.enum(["smoke", "repeat", "retry", "final"]),
  maxOutputTokens: Count.positive(), at: Timestamp
});
const Usage = z.strictObject({
  requestId: Id, outputTokens: Count.nullable(),
  aiCredits: z.number().finite().nonnegative().nullable()
});

export class BudgetLedger {
  private readonly db: DatabaseSync;
  private readonly limits: z.infer<typeof Limits>;

  constructor(database: string, limits: unknown, startedAt: string) {
    this.limits = Limits.parse(limits);
    Timestamp.parse(startedAt);
    this.db = new DatabaseSync(database, { timeout: 5000 });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS budget_meta (id INTEGER PRIMARY KEY CHECK(id=1), hash TEXT NOT NULL, started TEXT NOT NULL, last_at TEXT NOT NULL, blocked TEXT);
      CREATE TABLE IF NOT EXISTS budget_calls (id TEXT PRIMARY KEY, arm TEXT NOT NULL, episode TEXT NOT NULL, phase TEXT NOT NULL, reserved INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0, output INTEGER, credits REAL);
    `);
    const hash = digest({ limits: this.limits, startedAt });
    this.db.prepare("INSERT OR IGNORE INTO budget_meta VALUES(1, ?, ?, ?, NULL)").run(hash, startedAt, startedAt);
    if (this.db.prepare("SELECT hash FROM budget_meta WHERE id=1").get()?.hash !== hash) {
      this.db.close();
      throw new Error("Budget configuration changed across restart");
    }
  }

  close(): void { if (this.db.isOpen) this.db.close(); }

  reserve(input: unknown): void {
    const request = Reservation.parse(input);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const meta = this.db.prepare("SELECT started, last_at, blocked FROM budget_meta WHERE id=1").get();
      if (meta?.blocked) throw new Error(`Budget blocked: ${String(meta.blocked)}`);
      const elapsed = Date.parse(request.at) - Date.parse(Timestamp.parse(meta?.started));
      if (Date.parse(request.at) < Date.parse(Timestamp.parse(meta?.last_at)) || elapsed >= this.limits.maxElapsedMs) {
        throw new Error("Budget clock reversed or deadline reached");
      }
      if (request.maxOutputTokens > this.limits.maxOutputTokensPerCall) throw new Error("Per-call token cap exceeded");
      if (this.db.prepare(
        "SELECT 1 FROM budget_calls WHERE settled=0 OR credits IS NULL OR output IS NULL LIMIT 1"
      ).get()) throw new Error("Budget blocked: unsettled usage requires reconciliation");
      for (const scope of ["total", "arm"] as const) {
        const row = scope === "total" ?
          this.db.prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(reserved),0) AS tokens, COALESCE(SUM(credits),0) AS credits FROM budget_calls").get() :
          this.db.prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(reserved),0) AS tokens, COALESCE(SUM(credits),0) AS credits FROM budget_calls WHERE arm=?").get(request.arm);
        const cap = scope === "total" ? this.limits.total : this.limits.perArm[request.arm];
        if (Count.parse(row?.calls) >= cap.requests ||
            Count.parse(row?.tokens) + request.maxOutputTokens > cap.reservedOutputTokens ||
            z.number().parse(row?.credits) >= cap.aiCredits) throw new Error(`${scope} budget exhausted`);
      }
      const attempts = Count.parse(this.db.prepare(
        "SELECT COUNT(*) AS n FROM budget_calls WHERE arm=? AND episode=?"
      ).get(request.arm, request.episodeId)?.n);
      if (attempts >= this.limits.maxAttemptsPerEpisode) throw new Error("Episode attempt cap exceeded");
      this.db.prepare("INSERT INTO budget_calls (id,arm,episode,phase,reserved) VALUES (?,?,?,?,?)")
        .run(request.requestId, request.arm, request.episodeId, request.phase, request.maxOutputTokens);
      this.db.prepare("UPDATE budget_meta SET last_at=? WHERE id=1").run(request.at);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  settle(input: unknown): void {
    const usage = Usage.parse(input);
    this.db.exec("BEGIN IMMEDIATE");
    let violation: string | null = null;
    try {
      const row = this.db.prepare("SELECT reserved, settled FROM budget_calls WHERE id=?").get(usage.requestId);
      if (!row || row.settled !== 0) throw new Error("Unknown or already settled reservation");
      this.db.prepare("UPDATE budget_calls SET settled=1, output=?, credits=? WHERE id=?")
        .run(usage.outputTokens, usage.aiCredits, usage.requestId);
      if (usage.aiCredits === null || usage.outputTokens === null) violation = "Unknown usage requires reconciliation";
      else if (usage.outputTokens > Count.parse(row.reserved)) violation = "Provider exceeded reserved output tokens";
      if (violation) this.db.prepare("UPDATE budget_meta SET blocked=? WHERE id=1").run(violation);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    if (violation) throw new Error(violation);
  }

  summary() {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS requests, COALESCE(SUM(reserved),0) AS reservedOutputTokens, SUM(credits) AS knownCredits, SUM(CASE WHEN settled=0 OR credits IS NULL THEN 1 ELSE 0 END) AS unknown FROM budget_calls"
    ).get();
    return {
      requests: Count.parse(row?.requests), reservedOutputTokens: Count.parse(row?.reservedOutputTokens),
      aiCredits: row?.unknown === 0 && row.requests !== 0 ? z.number().parse(row.knownCredits) : null,
      pricingCurrency: null,
      enforcement: "offline-admission-primitives-not-live-provider-enforcement" as const
    };
  }
}
