import type { VaultRecord, VaultStore } from "../core";

/** The parts of Cloudflare's D1 binding this store uses, so no extra type package is needed. */
export interface D1Like {
  prepare(sql: string): D1Statement;
  exec(sql: string): Promise<unknown>;
}
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes?: number } }>;
}

const SCHEMA =
  "CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, version INTEGER NOT NULL, data BLOB NOT NULL, updated_at INTEGER NOT NULL)";

/**
 * Vaults in a Cloudflare D1 (SQLite) database.
 *
 * D1 rather than KV because KV is eventually consistent and has no compare-and-swap;
 * here a conditional UPDATE is atomic. The table is created on first use, so there is no
 * migration step to run when setting up.
 */
export class D1Store implements VaultStore {
  #ready: Promise<unknown> | null = null;

  constructor(private readonly db: D1Like) {}

  #init(): Promise<unknown> {
    this.#ready ??= this.db.exec(SCHEMA).catch((error) => {
      this.#ready = null;
      throw error;
    });
    return this.#ready;
  }

  async get(id: string): Promise<VaultRecord | null> {
    await this.#init();
    const row = await this.db
      .prepare("SELECT token_hash, version, data, updated_at FROM vaults WHERE id = ?")
      .bind(id)
      .first<{ token_hash: string; version: number; data: ArrayBuffer | number[]; updated_at: number }>();
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      version: row.version,
      data: new Uint8Array(row.data as ArrayBuffer),
      updatedAt: row.updated_at,
    };
  }

  async create(id: string, record: VaultRecord): Promise<boolean> {
    await this.#init();
    const result = await this.db
      .prepare(
        "INSERT INTO vaults (id, token_hash, version, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(id, record.tokenHash, record.version, record.data, record.updatedAt)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async update(id: string, expectedVersion: number, record: VaultRecord): Promise<boolean> {
    await this.#init();
    const result = await this.db
      .prepare("UPDATE vaults SET version = ?, data = ?, updated_at = ? WHERE id = ? AND version = ?")
      .bind(record.version, record.data, record.updatedAt, id, expectedVersion)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async delete(id: string): Promise<void> {
    await this.#init();
    await this.db.prepare("DELETE FROM vaults WHERE id = ?").bind(id).run();
  }
}
