import { chunkId, openChunk, SealError, sealChunk, type VaultKeys } from "./crypto";

/**
 * Moving course archives to and from the sync server.
 *
 * An archive is cut into fixed-size chunks (4 MB by default, which the server sets to
 * fit its host's request limit). Each chunk is named by a keyed hash of its contents and
 * encrypted with the vault's key before it leaves the device. Uploading first asks the
 * server which chunks it is missing and sends only those, so:
 *
 *  - an interrupted upload resumes where it stopped;
 *  - a course another device in the vault already uploaded costs one request;
 *  - re-importing a newer download of a course re-sends only the parts that changed.
 *
 * Downloading fetches the chunks, checks each one decrypts and matches its name, and
 * reassembles the original .zip, which is then imported as if the user had chosen it.
 */

export interface Transfer {
  /** Bytes hashed, sent or received so far, out of `total`. */
  done: number;
  total: number;
  phase: "checking" | "uploading" | "downloading" | "importing";
}

export interface ChunkClient {
  query(ids: string[]): Promise<{ missing: string[]; usedBytes: number; quotaBytes: number }>;
  put(id: string, data: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array>;
  remove(ids: string[]): Promise<void>;
}

export class CourseStorageError extends Error {}

/** Talk to the chunk routes of a vault on `server`. */
export function chunkClient(server: string, keys: VaultKeys, fetcher: typeof fetch = fetch): ChunkClient {
  const base = `${server}/api/v1/vaults/${keys.vaultId}/chunks`;
  const auth = { Authorization: `Bearer ${keys.token}` };

  const send = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetcher(url, { ...init, headers: { ...auth, ...init.headers } });
    if (response.ok) return response;
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    const error = new CourseStorageError(body.message ?? `The sync server answered ${response.status}.`);
    (error as CourseStorageError & { status: number }).status = response.status;
    throw error;
  };

  return {
    async query(ids) {
      const response = await send(`${base}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      return response.json();
    },
    async put(id, data) {
      await send(`${base}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: data as Uint8Array<ArrayBuffer>,
      });
    },
    async get(id) {
      return new Uint8Array(await (await send(`${base}/${id}`)).arrayBuffer());
    },
    async remove(ids) {
      if (ids.length === 0) return;
      await send(`${base}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    },
  };
}

interface UploadOptions {
  client: ChunkClient;
  keys: VaultKeys;
  chunkBytes: number;
  onProgress?: (transfer: Transfer) => void;
  /** Chunks in flight at once. */
  concurrency?: number;
}

/** Upload an archive; returns the chunk ids, in order, that reassemble it. */
export async function uploadArchive(archive: Blob, options: UploadOptions): Promise<string[]> {
  const { client, keys, chunkBytes, onProgress = () => {}, concurrency = 3 } = options;
  const count = Math.max(1, Math.ceil(archive.size / chunkBytes));
  const slice = (index: number) => archive.slice(index * chunkBytes, (index + 1) * chunkBytes);

  // Name every chunk first, so one request can find out what the server lacks.
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    ids.push(await chunkId(keys, new Uint8Array(await slice(index).arrayBuffer())));
    onProgress({ phase: "checking", done: Math.min(archive.size, (index + 1) * chunkBytes), total: archive.size });
  }

  const { missing, usedBytes, quotaBytes } = await client.query(ids);
  const wanted = new Set(missing);
  const pending = ids.map((id, index) => ({ id, index })).filter(({ id }) => wanted.has(id));
  const toSend = pending.reduce((sum, { index }) => sum + slice(index).size, 0);
  if (usedBytes + toSend > quotaBytes) {
    throw new CourseStorageError(
      `Not enough room on the sync server: this course needs ${toSend} more bytes and ${Math.max(0, quotaBytes - usedBytes)} are free.`,
    );
  }

  let sent = 0;
  onProgress({ phase: "uploading", done: 0, total: toSend });
  await pool(pending, concurrency, async ({ id, index }) => {
    const plain = new Uint8Array(await slice(index).arrayBuffer());
    const sealed = await sealChunk(keys, id, plain);
    await retry(() => client.put(id, sealed));
    sent += plain.byteLength;
    onProgress({ phase: "uploading", done: sent, total: toSend });
  });
  return ids;
}

interface DownloadOptions {
  client: ChunkClient;
  keys: VaultKeys;
  bytes: number;
  onProgress?: (transfer: Transfer) => void;
  concurrency?: number;
}

/** Download and reassemble an archive from its chunk ids. */
export async function downloadArchive(ids: string[], options: DownloadOptions): Promise<Blob> {
  const { client, keys, bytes, onProgress = () => {}, concurrency = 3 } = options;
  const parts: Blob[] = new Array(ids.length);
  let received = 0;

  onProgress({ phase: "downloading", done: 0, total: bytes });
  await pool(
    ids.map((id, index) => ({ id, index })),
    concurrency,
    async ({ id, index }) => {
      const plain = await retry(async () => openChunk(keys, id, await client.get(id)));
      // Blobs rather than one big buffer, so the browser can keep a large course on disk.
      parts[index] = new Blob([plain as Uint8Array<ArrayBuffer>]);
      received += plain.byteLength;
      onProgress({ phase: "downloading", done: received, total: bytes });
    },
  );

  const archive = new Blob(parts, { type: "application/zip" });
  if (archive.size !== bytes) throw new CourseStorageError("The downloaded course is incomplete.");
  return archive;
}

/** Run `task` over `items`, at most `limit` at a time, stopping at the first failure. */
async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (failed === null && next < items.length) {
      const item = items[next++]!;
      try {
        await task(item);
      } catch (error) {
        failed ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed !== null) throw failed;
}

/**
 * Retry network failures and server errors with backoff. Refusals that will not change
 * on a retry (no room, too large, not allowed, a damaged chunk) fail at once.
 */
async function retry<T>(attempt: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (error) {
      const status = (error as { status?: number }).status;
      const permanent = status !== undefined && status < 500 && status !== 408 && status !== 429;
      const final = permanent || status === 507 || error instanceof SealError || i >= tries;
      if (final) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** i));
    }
  }
}
