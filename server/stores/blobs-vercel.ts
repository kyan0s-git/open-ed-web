import { del, get, list, put } from "@vercel/blob";
import type { BlobStore } from "../core";

/**
 * Course chunks in Vercel Blob, as private blobs. Reads the store's token from
 * BLOB_READ_WRITE_TOKEN, which Vercel sets when a Blob store is connected to the project.
 */
export class VercelBlobStore implements BlobStore {
  constructor(private readonly token?: string) {}

  async put(key: string, data: Uint8Array): Promise<void> {
    await put(key, Buffer.from(data), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/octet-stream",
      token: this.token,
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const result = await get(key, { access: "private", token: this.token });
    if (!result || result.statusCode !== 200) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 500) await del(keys.slice(i, i + 500), { token: this.token });
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000, token: this.token });
      out.push(...page.blobs.map((blob) => ({ key: blob.pathname, size: blob.size })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
}
