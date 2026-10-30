import type { BlobStore } from "../core";

/** Course chunks in memory. For tests and trying the server out. */
export class MemoryBlobStore implements BlobStore {
  #blobs = new Map<string, Uint8Array>();

  async put(key: string, data: Uint8Array): Promise<void> {
    this.#blobs.set(key, data.slice());
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.#blobs.get(key) ?? null;
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) this.#blobs.delete(key);
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    return [...this.#blobs]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, data]) => ({ key, size: data.byteLength }));
  }
}
