/**
 * The sync API, independent of where it runs.
 *
 * The server stores one opaque blob per "vault" and nothing else. Devices encrypt their
 * progress before uploading it (see src/sync/crypto.ts), so whoever runs the server
 * cannot read it, and there are no accounts: a vault is addressed by an id and guarded
 * by a token, both derived on the device from a secret the server never sees.
 *
 * Each host (Cloudflare, Vercel, plain Node) is a thin adapter that turns its request
 * into a standard Request, picks a VaultStore, and calls handleApi().
 *
 *   GET    /api/v1/health            → { ok, service, protocol, maxBytes }
 *   GET    /api/v1/vaults/:id        → the blob, with an ETag
 *   PUT    /api/v1/vaults/:id        → store a blob; If-Match "<etag>" to replace,
 *                                       If-None-Match * to create
 *   DELETE /api/v1/vaults/:id        → forget the vault
 *
 * Every vault request carries `Authorization: Bearer <token>`. The first PUT records a
 * hash of the token; later requests must present the same token.
 *
 * Where the host has a blob store, a vault can also hold course archives, uploaded in
 * chunks small enough for any host's request limit (Vercel's is 4.5 MB). Chunks are
 * encrypted on the device like everything else, and named by a keyed hash of their
 * contents, so re-uploading a course only sends the chunks the server is missing:
 *
 *   POST   /api/v1/vaults/:id/chunks/query   { ids } → { missing, usedBytes, quotaBytes }
 *   PUT    /api/v1/vaults/:id/chunks/:chunk  → store one chunk
 *   GET    /api/v1/vaults/:id/chunks/:chunk  → read one chunk
 *   POST   /api/v1/vaults/:id/chunks/delete  { ids } → remove chunks
 */

export const PROTOCOL = 1;
export const SERVICE = "open-ed-web-sync";

/** A progress file compresses to tens of kilobytes; this leaves generous headroom. */
export const DEFAULT_MAX_BYTES = 1024 * 1024;

/**
 * Course chunks: 4 MiB of archive per request, under Vercel's 4.5 MB request and
 * response cap with room for encryption overhead. Hosts with higher limits can raise it.
 */
export const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
/** Encryption adds a 16-byte tag; allow a little more for future framing. */
const CHUNK_OVERHEAD = 64;
/** Per-vault course storage. A large OCW course is 100–500 MB. */
export const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

export interface VaultRecord {
  /** Incremented on every write; exposed as the ETag. */
  version: number;
  /** SHA-256 of the bearer token, hex. */
  tokenHash: string;
  data: Uint8Array;
  /** Milliseconds since the epoch. */
  updatedAt: number;
}

/**
 * Storage a host provides. Writes are compare-and-swap so two devices saving at the
 * same moment cannot silently overwrite each other: the loser gets a 412 and merges.
 */
export interface VaultStore {
  get(id: string): Promise<VaultRecord | null>;
  /** Create the vault; false if it already exists. */
  create(id: string, record: VaultRecord): Promise<boolean>;
  /** Replace the vault if it is still at `expectedVersion`; false otherwise. */
  update(id: string, expectedVersion: number, record: VaultRecord): Promise<boolean>;
  delete(id: string): Promise<void>;
}

/**
 * Object storage for course chunks, keyed "<vault id>/<chunk id>". Optional: without
 * one, the server syncs progress only and says so in /health.
 */
export interface BlobStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: string[]): Promise<void>;
  /** Every key under a prefix, with its size. */
  list(prefix: string): Promise<{ key: string; size: number }[]>;
}

export interface ApiOptions {
  /** Largest accepted upload, in bytes. */
  maxBytes?: number;
  /** Where course chunks go; omit to offer progress sync only. */
  blobs?: BlobStore | null;
  /** Largest course chunk, before encryption. */
  chunkBytes?: number;
  /** Course storage allowed per vault. */
  quotaBytes?: number;
  /**
   * Origins allowed to call the API from a browser, or "*". Requests authenticate with
   * a bearer token rather than cookies, so "*" is safe and is the default; narrow it if
   * you only want your own site and desktop app to use your server.
   */
  allowedOrigins?: string[] | "*";
}

/** Read options from environment variables, the same names on every host. */
export function optionsFromEnv(env: Record<string, string | undefined>): ApiOptions {
  const positive = (value: string | undefined, fallback: number) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  const origins = env.SYNC_ALLOWED_ORIGINS?.trim();
  return {
    maxBytes: positive(env.SYNC_MAX_BYTES, DEFAULT_MAX_BYTES),
    chunkBytes: positive(env.COURSE_CHUNK_BYTES, DEFAULT_CHUNK_BYTES),
    quotaBytes: positive(env.COURSE_QUOTA_BYTES, DEFAULT_QUOTA_BYTES),
    allowedOrigins:
      !origins || origins === "*"
        ? "*"
        : origins
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean),
  };
}

const VAULT_ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const CHUNK_ID = /^[0-9a-f]{64}$/;
/** Ids per query or delete request; a 500 MB course is about 120 chunks. */
const MAX_IDS = 5000;

/**
 * Handle a request if it is for the API; return null otherwise so the host can serve
 * the web app instead.
 */
export async function handleApi(
  request: Request,
  store: VaultStore,
  options: ApiOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = apiPath(url);
  if (path === null) return null;

  const cors = corsHeaders(request, options.allowedOrigins ?? "*");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    const response = await route(request, path, store, options);
    for (const [name, value] of cors) response.headers.set(name, value);
    return response;
  } catch (error) {
    console.error("sync api error", error);
    return json({ error: "server_error", message: "The sync server failed to handle this request." }, 500, cors);
  }
}

/**
 * The API path below /api/v1, or null. Hosts that rewrite every API request to a single
 * function (Vercel) pass the original path in a `route` query parameter instead.
 */
function apiPath(url: URL): string | null {
  if (url.pathname.startsWith("/api/v1/")) return url.pathname.slice("/api/v1".length);
  const routed = url.searchParams.get("route");
  if (url.pathname.startsWith("/api/") && routed !== null) return `/${routed.replace(/^\/+/, "")}`;
  return null;
}

async function route(request: Request, path: string, store: VaultStore, options: ApiOptions): Promise<Response> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (path === "/health") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const courses = options.blobs
      ? { chunkBytes: options.chunkBytes ?? DEFAULT_CHUNK_BYTES, quotaBytes: options.quotaBytes ?? DEFAULT_QUOTA_BYTES }
      : null;
    return json({ ok: true, service: SERVICE, protocol: PROTOCOL, maxBytes, courses });
  }

  const match = /^\/vaults\/([^/]+)(\/chunks\/[^/]+)?$/.exec(path);
  if (!match) return json({ error: "not_found" }, 404);

  const id = match[1]!;
  if (!VAULT_ID.test(id)) return json({ error: "bad_vault_id" }, 400);

  const token = bearer(request);
  if (!token) return json({ error: "unauthorized", message: "Missing or malformed bearer token." }, 401);
  const tokenHash = await sha256Hex(token);

  const existing = await store.get(id);
  if (existing && !timingSafeEqual(existing.tokenHash, tokenHash)) {
    return json({ error: "forbidden", message: "This token does not open this vault." }, 403);
  }

  if (match[2]) {
    if (!existing) return json({ error: "not_found", message: "Create the vault before storing courses in it." }, 404);
    return chunks(request, id, match[2].slice("/chunks/".length), options);
  }

  switch (request.method) {
    case "GET": {
      if (!existing) return json({ error: "not_found" }, 404);
      const etag = etagFor(existing.version);
      if (request.headers.get("If-None-Match") === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
      }
      return new Response(existing.data as Uint8Array<ArrayBuffer>, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          ETag: etag,
          "Last-Modified": new Date(existing.updatedAt).toUTCString(),
          "Cache-Control": "no-store",
        },
      });
    }

    case "PUT": {
      const declared = Number(request.headers.get("Content-Length"));
      if (declared > maxBytes) return tooLarge(maxBytes);
      const data = new Uint8Array(await request.arrayBuffer());
      if (data.byteLength > maxBytes) return tooLarge(maxBytes);
      if (data.byteLength === 0) return json({ error: "empty_body" }, 400);

      const ifMatch = request.headers.get("If-Match");
      const ifNoneMatch = request.headers.get("If-None-Match");
      const now = Date.now();

      if (ifNoneMatch === "*") {
        if (existing) return preconditionFailed(existing.version);
        const created = await store.create(id, { version: 1, tokenHash, data, updatedAt: now });
        if (!created) return preconditionFailed((await store.get(id))?.version);
        return json({ ok: true }, 201, { ETag: etagFor(1) });
      }

      if (ifMatch) {
        const expected = parseEtag(ifMatch);
        if (!existing || expected === null || expected !== existing.version) {
          return preconditionFailed(existing?.version);
        }
        const next = expected + 1;
        const updated = await store.update(id, expected, { version: next, tokenHash, data, updatedAt: now });
        if (!updated) return preconditionFailed((await store.get(id))?.version);
        return json({ ok: true }, 200, { ETag: etagFor(next) });
      }

      return json(
        { error: "precondition_required", message: "Send If-Match to replace a vault or If-None-Match: * to create one." },
        428,
      );
    }

    case "DELETE": {
      if (!existing) return new Response(null, { status: 204 });
      if (options.blobs) {
        const keys = (await options.blobs.list(`${id}/`)).map((entry) => entry.key);
        if (keys.length > 0) await options.blobs.delete(keys);
      }
      await store.delete(id);
      return new Response(null, { status: 204 });
    }

    default:
      return methodNotAllowed("GET, PUT, DELETE");
  }
}

/** Course chunk routes, for a vault whose token has already been checked. */
async function chunks(request: Request, vault: string, name: string, options: ApiOptions): Promise<Response> {
  const blobs = options.blobs;
  if (!blobs) {
    return json({ error: "courses_not_supported", message: "This server does not store courses." }, 501);
  }
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const quotaBytes = options.quotaBytes ?? DEFAULT_QUOTA_BYTES;
  const usage = async () => {
    const entries = await blobs.list(`${vault}/`);
    return { entries, used: entries.reduce((sum, entry) => sum + entry.size, 0) };
  };

  if (name === "query" || name === "delete") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const ids = await readIds(request);
    if (!ids) return json({ error: "bad_request", message: `Send { "ids": [...] } with at most ${MAX_IDS} chunk ids.` }, 400);

    if (name === "delete") {
      if (ids.length > 0) await blobs.delete(ids.map((chunk) => `${vault}/${chunk}`));
      return new Response(null, { status: 204 });
    }
    const { entries, used } = await usage();
    const present = new Set(entries.map((entry) => entry.key.slice(vault.length + 1)));
    return json({ missing: ids.filter((chunk) => !present.has(chunk)), usedBytes: used, quotaBytes });
  }

  if (!CHUNK_ID.test(name)) return json({ error: "bad_chunk_id" }, 400);
  const key = `${vault}/${name}`;

  switch (request.method) {
    case "GET": {
      const data = await blobs.get(key);
      if (!data) return json({ error: "not_found" }, 404);
      return new Response(data as Uint8Array<ArrayBuffer>, {
        headers: {
          "Content-Type": "application/octet-stream",
          // A chunk's name is a hash of its contents, so it never changes.
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    }

    case "PUT": {
      const limit = chunkBytes + CHUNK_OVERHEAD;
      if (Number(request.headers.get("Content-Length")) > limit) return tooLarge(limit);
      const data = new Uint8Array(await request.arrayBuffer());
      if (data.byteLength > limit) return tooLarge(limit);
      if (data.byteLength === 0) return json({ error: "empty_body" }, 400);

      const { entries, used } = await usage();
      const replacing = entries.find((entry) => entry.key === key)?.size ?? 0;
      if (used - replacing + data.byteLength > quotaBytes) {
        return json(
          { error: "quota_exceeded", message: `This vault may store up to ${quotaBytes} bytes of courses.`, usedBytes: used, quotaBytes },
          507,
        );
      }
      await blobs.put(key, data);
      return json({ ok: true }, 201);
    }

    default:
      return methodNotAllowed("GET, PUT");
  }
}

async function readIds(request: Request): Promise<string[] | null> {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_IDS) return null;
  if (!ids.every((chunk): chunk is string => typeof chunk === "string" && CHUNK_ID.test(chunk))) return null;
  return [...new Set(ids)];
}

function corsHeaders(request: Request, allowed: string[] | "*"): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (allowed === "*") headers.set("Access-Control-Allow-Origin", "*");
  else if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, If-None-Match");
  headers.set("Access-Control-Expose-Headers", "ETag");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match && TOKEN.test(match[1]!) ? match[1]! : null;
}

export function etagFor(version: number): string {
  return `"${version}"`;
}

function parseEtag(value: string): number | null {
  const match = /^(?:W\/)?"(\d+)"$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const response = new Response(JSON.stringify(body), { status, headers });
  response.headers.set("Content-Type", "application/json");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function preconditionFailed(current: number | undefined): Response {
  return json(
    { error: "precondition_failed", message: "The vault changed since you last read it." },
    412,
    current === undefined ? {} : { ETag: etagFor(current) },
  );
}

function tooLarge(maxBytes: number): Response {
  return json({ error: "too_large", message: `Uploads are limited to ${maxBytes} bytes.` }, 413);
}

function methodNotAllowed(allow: string): Response {
  return json({ error: "method_not_allowed" }, 405, { Allow: allow });
}
