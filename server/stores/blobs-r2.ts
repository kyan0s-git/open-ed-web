import type { BlobStore } from "../core";

/** The parts of Cloudflare's R2 binding this store uses, so no extra type package is needed. */
export interface R2Like {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{
    objects: { key: string; size: number }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

/** Course chunks in a Cloudflare R2 bucket. */
export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2Like) {}

  async put(key: string, data: Uint8Array): Promise<void> {
    await this.bucket.put(key, data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const object = await this.bucket.get(key);
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  }

  async delete(keys: string[]): Promise<void> {
    // R2 deletes up to 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) await this.bucket.delete(keys.slice(i, i + 1000));
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor, limit: 1000 });
      out.push(...page.objects.map((object) => ({ key: object.key, size: object.size })));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
}
