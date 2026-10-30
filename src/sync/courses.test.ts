// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handleApi } from "../../server/core";
import { MemoryStore } from "../../server/stores/memory";
import { MemoryBlobStore } from "../../server/stores/blobs-memory";
import { deriveKeys, newSecret, type VaultKeys } from "./crypto";
import { chunkClient, downloadArchive, uploadArchive, type ChunkClient } from "./courses";

const SERVER = "https://sync.test";
const CHUNK = 1000;

async function setup(options: { quotaBytes?: number } = {}) {
  const store = new MemoryStore();
  const blobs = new MemoryBlobStore();
  const puts: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === "PUT" && request.url.includes("/chunks/")) puts.push(request.url.split("/").pop()!);
    return (await handleApi(request, store, { blobs, chunkBytes: CHUNK, quotaBytes: options.quotaBytes })) ?? new Response(null, { status: 404 });
  }) as typeof fetch;

  const keys = await deriveKeys(newSecret());
  // Course storage lives inside a vault, so create one first.
  await fetcher(`${SERVER}/api/v1/vaults/${keys.vaultId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${keys.token}`, "If-None-Match": "*" },
    body: new Uint8Array([1]),
  });
  return { keys, blobs, puts, client: chunkClient(SERVER, keys, fetcher) };
}

function archive(size: number, seed = 1): Blob {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + seed * 17) % 251;
  return new Blob([bytes]);
}

const upload = (blob: Blob, client: ChunkClient, keys: VaultKeys) => uploadArchive(blob, { client, keys, chunkBytes: CHUNK });

describe("course transfer", () => {
  it("uploads in chunks and downloads the same bytes", async () => {
    const { keys, client, puts, blobs } = await setup();
    const original = archive(3500);

    const ids = await upload(original, client, keys);
    expect(ids).toHaveLength(4);
    expect(puts).toHaveLength(4);
    // What the server holds is not the archive.
    const stored = await blobs.get(`${keys.vaultId}/${ids[0]}`);
    expect(stored!.slice(1, 50)).not.toEqual(new Uint8Array(await original.slice(0, 49).arrayBuffer()));

    const copy = await downloadArchive(ids, { client, keys, bytes: original.size });
    expect(new Uint8Array(await copy.arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()));
  });

  it("sends only what the server lacks: resuming, or uploading from a second device", async () => {
    const { keys, client, puts } = await setup();
    const original = archive(3500);

    // An upload that died after two chunks.
    let sent = 0;
    const flaky: ChunkClient = {
      ...client,
      put: async (id, data) => {
        if (++sent > 2) throw Object.assign(new Error("connection lost"), { status: 400 });
        await client.put(id, data);
      },
    };
    await expect(upload(original, flaky, keys)).rejects.toThrow("connection lost");
    expect(puts).toHaveLength(2);

    await upload(original, client, keys);
    expect(puts).toHaveLength(4);

    // Same course again, as another device in the vault would upload it: nothing sent.
    await upload(original, client, keys);
    expect(puts).toHaveLength(4);
  });

  it("re-sends only changed chunks for a newer download of a course", async () => {
    const { keys, client, puts } = await setup();
    const bytes = new Uint8Array(await archive(3500).arrayBuffer());
    await upload(new Blob([bytes]), client, keys);
    bytes[3200]! ^= 0xff; // the zip's central directory, at the end, changes
    await upload(new Blob([bytes]), client, keys);
    expect(puts).toHaveLength(5);
  });

  it("refuses a chunk the server altered", async () => {
    const { keys, client, blobs } = await setup();
    const ids = await upload(archive(1500), client, keys);
    const key = `${keys.vaultId}/${ids[1]}`;
    const tampered = (await blobs.get(key))!;
    tampered[10]! ^= 1;
    await blobs.put(key, tampered);
    await expect(downloadArchive(ids, { client, keys, bytes: 1500 })).rejects.toThrow(/damaged/);
  });

  it("checks the quota before sending anything", async () => {
    const { keys, client, puts } = await setup({ quotaBytes: 2000 });
    await expect(upload(archive(3500), client, keys)).rejects.toThrow(/Not enough room/);
    expect(puts).toEqual([]);
  });
});
