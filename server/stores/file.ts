import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { VaultRecord, VaultStore } from "../core";

/**
 * One file per vault in a directory, for the self-hosted Node server.
 *
 * Compare-and-swap is enforced by queueing operations per vault inside this process,
 * and files are replaced by rename so a crash never leaves half a vault. Run one server
 * process per data directory.
 */
export class FileStore implements VaultStore {
  #queues = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  async get(id: string): Promise<VaultRecord | null> {
    try {
      const raw = JSON.parse(await readFile(this.#path(id), "utf8")) as Omit<VaultRecord, "data"> & { data: string };
      return { ...raw, data: new Uint8Array(Buffer.from(raw.data, "base64")) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  create(id: string, record: VaultRecord): Promise<boolean> {
    return this.#serial(id, async () => {
      if (await this.get(id)) return false;
      await this.#write(id, record);
      return true;
    });
  }

  update(id: string, expectedVersion: number, record: VaultRecord): Promise<boolean> {
    return this.#serial(id, async () => {
      if ((await this.get(id))?.version !== expectedVersion) return false;
      await this.#write(id, record);
      return true;
    });
  }

  delete(id: string): Promise<void> {
    return this.#serial(id, () => rm(this.#path(id), { force: true }));
  }

  #path(id: string): string {
    // Ids are validated as 32 hex characters before they reach a store.
    return join(this.dir, `${id}.json`);
  }

  async #write(id: string, record: VaultRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const temp = join(this.dir, `.${id}.${randomUUID()}.tmp`);
    const body = { ...record, data: Buffer.from(record.data).toString("base64") };
    await writeFile(temp, JSON.stringify(body));
    await rename(temp, this.#path(id));
  }

  #serial<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(id) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => {});
    this.#queues.set(id, settled);
    void settled.then(() => {
      if (this.#queues.get(id) === settled) this.#queues.delete(id);
    });
    return next;
  }
}
