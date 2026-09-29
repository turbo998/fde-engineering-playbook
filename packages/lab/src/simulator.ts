import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Count, EffectRequest, Id, Resource, Timestamp } from "../../contracts/src/index.js";
import { canonicalJson, digest } from "./encoding.js";
import { Attempt, Dataset, Effect, Fault, Fixture, Snapshot } from "./dataset.js";
export { Attempt, Dataset, Effect, Fault, Fixture, Snapshot } from "./dataset.js";

export type Attempt = z.infer<typeof Attempt>;
export type Snapshot = z.infer<typeof Snapshot>;
type Fixture = z.infer<typeof Fixture>;
type Dataset = z.infer<typeof Dataset>;

function storedJson(value: unknown): unknown {
  if (typeof value !== "string") throw new Error("Invalid persisted JSON");
  return JSON.parse(value) as unknown;
}

export class Simulator {
  private readonly db: DatabaseSync;

  constructor(database: string) {
    this.db = new DatabaseSync(database, { timeout: 5000 });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sim_meta (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, reads INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sim_attempts (sequence INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sim_effects (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(tenant, key));
    `);
  }

  close(): void { if (this.db.isOpen) this.db.close(); }

  reset(input: unknown): void {
    const data = Dataset.parse(input);
    this.transaction(() => {
      this.db.exec("DELETE FROM sim_attempts; DELETE FROM sim_effects; DELETE FROM sim_meta");
      this.db.prepare("INSERT INTO sim_meta VALUES (1, ?, 0)").run(canonicalJson(data));
    });
  }

  advanceTo(input: unknown): void {
    const timestamp = Timestamp.parse(input);
    this.transaction(() => {
      const data = this.dataset();
      if (Date.parse(timestamp) < Date.parse(data.clock)) throw new Error("Clock cannot move backwards");
      data.clock = timestamp;
      this.db.prepare("UPDATE sim_meta SET data=? WHERE id=1").run(canonicalJson(data));
    });
  }

  read(tenantId: string, kind: z.infer<typeof Resource>["kind"]): {
    status: "ok"; fixtures: Fixture[];
  } | { status: "fault"; code: z.infer<typeof Fault>["code"] } {
    Id.parse(tenantId);
    if (!Resource.options.map((option) => option.shape.kind.value).includes(kind)) {
      throw new Error("Unknown resource kind");
    }
    return this.transaction(() => {
      const data = this.dataset();
      this.db.exec("UPDATE sim_meta SET reads=reads+1 WHERE id=1");
      const call = Count.parse(this.db.prepare("SELECT reads FROM sim_meta WHERE id=1").get()?.reads);
      const fault = data.faults.find((item) => item.operation === "read" && item.call === call);
      if (fault) return { status: "fault", code: fault.code };
      return { status: "ok", fixtures: data.fixtures.filter((item) =>
        item.resource.kind === kind && item.resource.data.tenantId === tenantId) };
    });
  }

  attempt(input: unknown): Attempt {
    const request = EffectRequest.parse(input);
    return this.transaction(() => {
      const data = this.dataset();
      const count = Count.parse(this.db.prepare("SELECT COUNT(*) AS n FROM sim_attempts").get()?.n);
      const sequence = count + 1;
      const prior = this.db.prepare("SELECT hash, data FROM sim_effects WHERE tenant=? AND key=?")
        .get(request.tenantId, request.idempotencyKey);
      const fault = data.faults.find((item) => item.operation === "effect" && item.call === sequence);
      let outcome: Attempt["outcome"];
      let effectId: string | null = null;
      if (prior) {
        outcome = prior.hash === digest(request) ? "duplicate" : "conflict";
        if (outcome === "duplicate") effectId = Effect.parse(storedJson(prior.data)).id;
      } else if (fault) {
        outcome = "fault";
      } else {
        outcome = "accepted";
        effectId = `synthetic-effect-${sequence}`;
        const effect = Effect.parse({ id: effectId, at: data.clock, request, delivered: false });
        // This service deliberately does not authorize the application's business action.
        this.db.prepare("INSERT INTO sim_effects VALUES (?, ?, ?, ?, ?)")
          .run(effectId, request.tenantId, request.idempotencyKey, digest(request), canonicalJson(effect));
      }
      const attempt = Attempt.parse({
        sequence, at: data.clock, request, outcome, effectId,
        faultCode: outcome === "fault" ? fault?.code : null
      });
      this.db.prepare("INSERT INTO sim_attempts VALUES (?, ?)").run(sequence, canonicalJson(attempt));
      return attempt;
    });
  }

  snapshot(): Snapshot {
    return this.transaction(() => {
      const data = this.dataset();
      return Snapshot.parse({
        kind: "synthetic-service-ledger", clock: data.clock, policyVersion: data.policyVersion,
        reads: this.db.prepare("SELECT reads FROM sim_meta WHERE id=1").get()?.reads,
        attempts: this.db.prepare("SELECT data FROM sim_attempts ORDER BY sequence").all()
          .map((row) => storedJson(row.data)),
        effects: this.db.prepare("SELECT data FROM sim_effects ORDER BY rowid").all()
          .map((row) => storedJson(row.data))
      });
    }, "read");
  }

  private dataset(): Dataset {
    const row = this.db.prepare("SELECT data FROM sim_meta WHERE id=1").get();
    if (!row) throw new Error("Simulator requires an explicitly initialized dataset");
    return Dataset.parse(storedJson(row.data));
  }

  private transaction<T>(body: () => T, mode: "read" | "write" = "write"): T {
    this.db.exec(mode === "read" ? "BEGIN" : "BEGIN IMMEDIATE");
    try {
      const result = body();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
