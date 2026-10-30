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
 */

export const PROTOCOL = 1;
export const SERVICE = "open-ed-web-sync";

/** A progress file compresses to tens of kilobytes; this leaves generous headroom. */
export const DEFAULT_MAX_BYTES = 1024 * 1024;

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

export interface ApiOptions {
  /** Largest accepted upload, in bytes. */
  maxBytes?: number;
  /**
   * Origins allowed to call the API from a browser, or "*". Requests authenticate with
   * a bearer token rather than cookies, so "*" is safe and is the default; narrow it if
   * you only want your own site and desktop app to use your server.
   */
  allowedOrigins?: string[] | "*";
}

/** Read options from environment variables, the same names on every host. */
export function optionsFromEnv(env: Record<string, string | undefined>): ApiOptions {
  const max = Number(env.SYNC_MAX_BYTES);
  const origins = env.SYNC_ALLOWED_ORIGINS?.trim();
  return {
    maxBytes: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_BYTES,
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
    return json({ ok: true, service: SERVICE, protocol: PROTOCOL, maxBytes });
  }

  const match = /^\/vaults\/([^/]+)$/.exec(path);
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
      await store.delete(id);
      return new Response(null, { status: 204 });
    }

    default:
      return methodNotAllowed("GET, PUT, DELETE");
  }
}

function corsHeaders(request: Request, allowed: string[] | "*"): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (allowed === "*") headers.set("Access-Control-Allow-Origin", "*");
  else if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
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
