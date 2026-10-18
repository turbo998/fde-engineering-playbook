import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Count, EffectRequest, Id, Resource, Timestamp } from "../../contracts/src/index.js";
import { canonicalJson, digest } from "./encoding.js";
import { Attempt, CausalEvent, Dataset, Effect, Fault, Fixture, ReadAttempt, Snapshot, TrustedControlEvent, TrustedControlInput } from "./dataset.js";
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
      CREATE TABLE IF NOT EXISTS sim_reads (sequence INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sim_causal_events (sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, trusted_sequence INTEGER, data TEXT NOT NULL, UNIQUE(kind, trusted_sequence));
      CREATE TABLE IF NOT EXISTS sim_effects (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(tenant, key));
    `);
  }

  close(): void { if (this.db.isOpen) this.db.close(); }

  reset(input: unknown): void {
    const data = Dataset.parse(input);
    this.transaction(() => {
      this.db.exec("DELETE FROM sim_attempts; DELETE FROM sim_effects; DELETE FROM sim_reads; DELETE FROM sim_causal_events; DELETE FROM sim_meta");
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
      const attempt = ReadAttempt.parse({
        sequence: call, at: data.clock, tenantId, kind,
        outcome: fault ? "fault" : "ok", faultCode: fault?.code ?? null
      });
      this.db.prepare("INSERT INTO sim_reads VALUES (?, ?)").run(call, canonicalJson(attempt));
      if (fault) return { status: "fault", code: fault.code };
      return { status: "ok", fixtures: data.fixtures.filter((item) =>
        item.resource.kind === kind && item.resource.data.tenantId === tenantId) };
    });
  }

  recordTrustedControl(input: unknown): z.infer<typeof TrustedControlEvent> {
    const control = TrustedControlInput.parse(input);
    return this.transaction(() => {
      const data = this.dataset();
      const prior = this.db.prepare("SELECT data FROM sim_causal_events WHERE kind=? AND trusted_sequence=?")
        .get(control.kind, control.trustedSequence);
      if (prior) {
        const event = TrustedControlEvent.parse(storedJson(prior.data));
        if (event.eventDigest !== control.eventDigest) throw new Error("TRUSTED_CONTROL_CONFLICT");
        return event;
      }
      const event = TrustedControlEvent.parse({
        ...control, sequence: this.nextCausalSequence(), at: data.clock
      });
      this.db.prepare("INSERT INTO sim_causal_events VALUES (?, ?, ?, ?)")
        .run(event.sequence, event.kind, event.trustedSequence, canonicalJson(event));
      return event;
    });
  }

  attempt(input: unknown): Attempt {
    const request = EffectRequest.parse(input);
    return this.transaction(() => {
      const data = this.dataset();
      const count = Count.parse(this.db.prepare("SELECT COUNT(*) AS n FROM sim_attempts").get()?.n);
      const sequence = count + 1;
      const causalSequence = this.nextCausalSequence();
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
        const effect = Effect.parse({ id: effectId, at: data.clock, request, delivered: false, causalSequence });
        // This service deliberately does not authorize the application's business action.
        this.db.prepare("INSERT INTO sim_effects VALUES (?, ?, ?, ?, ?)")
          .run(effectId, request.tenantId, request.idempotencyKey, digest(request), canonicalJson(effect));
      }
      const attempt = Attempt.parse({
        sequence, at: data.clock, request, outcome, effectId,
        faultCode: outcome === "fault" ? fault?.code : null, causalSequence
      });
      const position = CausalEvent.parse({
        sequence: causalSequence, at: data.clock, kind: "effect-attempt",
        attemptSequence: sequence, requestDigest: digest(request), outcome, effectId
      });
      this.db.prepare("INSERT INTO sim_causal_events VALUES (?, ?, NULL, ?)")
        .run(causalSequence, position.kind, canonicalJson(position));
      this.db.prepare("INSERT INTO sim_attempts VALUES (?, ?)").run(sequence, canonicalJson(attempt));
      return attempt;
    });
  }

  snapshot(): Snapshot {
    return this.transaction(() => {
      const data = this.dataset();
      const reads = Count.parse(this.db.prepare("SELECT reads FROM sim_meta WHERE id=1").get()?.reads);
      const readAttempts = this.db.prepare("SELECT data FROM sim_reads ORDER BY sequence").all()
        .map((row) => ReadAttempt.parse(storedJson(row.data)));
      return Snapshot.parse({
        kind: "synthetic-service-ledger", clock: data.clock, policyVersion: data.policyVersion,
        reads, readAttempts: readAttempts.length === reads ? readAttempts : null,
        causalEvents: this.db.prepare("SELECT data FROM sim_causal_events ORDER BY sequence").all()
          .map((row) => CausalEvent.parse(storedJson(row.data))),
        attempts: this.db.prepare("SELECT data FROM sim_attempts ORDER BY sequence").all()
          .map((row) => storedJson(row.data)),
        effects: this.db.prepare("SELECT data FROM sim_effects ORDER BY rowid").all()
          .map((row) => storedJson(row.data))
      });
    }, "read");
  }

  private nextCausalSequence(): number {
    return Count.positive().parse(this.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS n FROM sim_causal_events").get()?.n);
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
