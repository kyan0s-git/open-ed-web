import type { VaultRecord, VaultStore } from "../core";

/** Keeps vaults in memory. For tests and trying the server out; nothing survives a restart. */
export class MemoryStore implements VaultStore {
  #vaults = new Map<string, VaultRecord>();

  async get(id: string): Promise<VaultRecord | null> {
    return this.#vaults.get(id) ?? null;
  }

  async create(id: string, record: VaultRecord): Promise<boolean> {
    if (this.#vaults.has(id)) return false;
    this.#vaults.set(id, record);
    return true;
  }

  async update(id: string, expectedVersion: number, record: VaultRecord): Promise<boolean> {
    if (this.#vaults.get(id)?.version !== expectedVersion) return false;
    this.#vaults.set(id, record);
    return true;
  }

  async delete(id: string): Promise<void> {
    this.#vaults.delete(id);
  }
}
