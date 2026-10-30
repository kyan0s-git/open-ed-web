import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { handleApi, optionsFromEnv, type BlobStore, type VaultStore } from "./core";
import { FileBlobStore } from "./stores/blobs-file";
import { MemoryBlobStore } from "./stores/blobs-memory";
import { FileStore } from "./stores/file";
import { MemoryStore } from "./stores/memory";
import { RedisRestStore, redisConfigFromEnv } from "./stores/redis";

/**
 * A self-contained server for running everything on your own machine or VPS: the web
 * app and the sync API, on one port, with vaults stored as files.
 *
 *   PORT          port to listen on (default 8787)
 *   HOST          interface to bind (default 0.0.0.0)
 *   DATA_DIR      where vaults and stored courses are kept (default ./data); "memory"
 *                 keeps them in RAM
 *   COURSE_STORAGE  "on" to also store course archives (in DATA_DIR/courses), so
 *                 devices can download courses instead of importing them again
 *   COURSE_QUOTA_BYTES, COURSE_CHUNK_BYTES   limits for stored courses
 *   STATIC_DIR    the built web app (default ./dist); set to "" to serve only the API
 *   UPSTASH_REDIS_REST_URL / _TOKEN   store vaults in Redis instead of files
 *   SYNC_MAX_BYTES, SYNC_ALLOWED_ORIGINS   see server/core.ts
 *
 * Put it behind a TLS-terminating proxy (Caddy, nginx, a tunnel): browsers only allow
 * the storage APIs the app needs on https:// or localhost.
 */

const env = process.env;
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? "0.0.0.0";
const staticDir = env.STATIC_DIR === "" ? null : resolve(env.STATIC_DIR ?? "dist");

function pickStore(): { store: VaultStore; label: string } {
  const redis = redisConfigFromEnv(env);
  if (redis) return { store: new RedisRestStore(redis), label: `redis ${new URL(redis.url).host}` };
  if (env.DATA_DIR === "memory") return { store: new MemoryStore(), label: "memory (not persisted)" };
  const dir = resolve(env.DATA_DIR ?? "data");
  return { store: new FileStore(dir), label: dir };
}

function pickBlobs(): { blobs: BlobStore | null; label: string } {
  if (env.COURSE_STORAGE !== "on") return { blobs: null, label: "off (set COURSE_STORAGE=on to store courses)" };
  if (env.DATA_DIR === "memory") return { blobs: new MemoryBlobStore(), label: "memory (not persisted)" };
  const dir = resolve(env.DATA_DIR ?? "data", "courses");
  return { blobs: new FileBlobStore(dir), label: dir };
}

const { store, label } = pickStore();
const { blobs, label: blobLabel } = pickBlobs();
const options = { ...optionsFromEnv(env), blobs };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".icc": "application/vnd.iccprofile",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const server = createServer(async (req, res) => {
  try {
    const request = toRequest(req);
    const api = await handleApi(request, store, options);
    if (api) return await send(res, api);
    if (staticDir && (req.method === "GET" || req.method === "HEAD")) return await serveStatic(req, res, staticDir);
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error");
  }
});

server.listen(port, host, () => {
  console.log(`open-ed-web listening on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(`  web app: ${staticDir ?? "not served"}`);
  console.log(`  vaults:  ${label}`);
  console.log(`  courses: ${blobLabel}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function toRequest(req: IncomingMessage): Request {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (value !== undefined) headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: "half",
  } as RequestInit);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const candidate = normalize(join(root, pathname));
  const inside = candidate === root || candidate.startsWith(root + sep);

  let file = inside ? candidate : null;
  if (file && !(await isFile(file))) file = null;
  // Single-page app: any path that is not a file gets index.html, unless it looks like
  // a missing asset, which should 404 rather than return HTML.
  if (!file && extname(pathname) === "") file = join(root, "index.html");
  if (!file || !(await isFile(file))) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }

  const hashed = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return void res.end();
  res.end(await readFile(file));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
