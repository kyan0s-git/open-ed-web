// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApi, optionsFromEnv, type VaultStore } from "./core";
import { MemoryStore } from "./stores/memory";
import { FileStore } from "./stores/file";
import { RedisRestStore } from "./stores/redis";
import { MemoryBlobStore } from "./stores/blobs-memory";
import { FileBlobStore } from "./stores/blobs-file";
import type { BlobStore } from "./core";

/**
 * The Redis store runs against a real Redis when one is reachable over Upstash's REST
 * protocol, e.g. Redis plus github.com/hiett/serverless-redis-http in Docker:
 *   REDIS_REST_URL=http://localhost:8079 REDIS_REST_TOKEN=devtoken npx vitest run server
 */
const redisUrl = process.env.REDIS_REST_URL;
const redisToken = process.env.REDIS_REST_TOKEN ?? "";

const ID = "0123456789abcdef0123456789abcdef";
const TOKEN = "a".repeat(64);
const OTHER = "b".repeat(64);
const BASE = "https://sync.example";

function call(store: VaultStore, path: string, init: RequestInit & { token?: string } = {}, options = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  return handleApi(new Request(`${BASE}${path}`, { ...init, headers }), store, options);
}

const bytes = (text: string) => new TextEncoder().encode(text);

for (const [name, make] of [
  ["memory", async () => ({ store: new MemoryStore(), done: async () => {} })],
  [
    "file",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "oew-sync-"));
      return { store: new FileStore(dir), done: () => rm(dir, { recursive: true, force: true }) };
    },
  ],
  [
    "redis",
    async () => {
      const prefix = `test:${Math.random().toString(36).slice(2)}:`;
      return { store: new RedisRestStore({ url: redisUrl!, token: redisToken, prefix }), done: async () => {} };
    },
  ],
] as const) {
  describe.skipIf(name === "redis" && !redisUrl)(`sync api (${name} store)`, () => {
    it("creates, reads and replaces a vault with compare-and-swap", async () => {
      const { store, done } = await make();
      try {
        expect((await call(store, `/api/v1/vaults/${ID}`, { token: TOKEN }))!.status).toBe(404);

        const created = (await call(store, `/api/v1/vaults/${ID}`, {
          method: "PUT",
          token: TOKEN,
          headers: { "If-None-Match": "*" },
          body: bytes("one"),
        }))!;
        expect(created.status).toBe(201);
        expect(created.headers.get("ETag")).toBe('"1"');

        const read = (await call(store, `/api/v1/vaults/${ID}`, { token: TOKEN }))!;
        expect(read.status).toBe(200);
        expect(await read.text()).toBe("one");

        const notModified = (await call(store, `/api/v1/vaults/${ID}`, { token: TOKEN, headers: { "If-None-Match": '"1"' } }))!;
        expect(notModified.status).toBe(304);

        // Creating again, or replacing from a stale version, is refused.
        expect(
          (await call(store, `/api/v1/vaults/${ID}`, { method: "PUT", token: TOKEN, headers: { "If-None-Match": "*" }, body: bytes("x") }))!
            .status,
        ).toBe(412);

        const replaced = (await call(store, `/api/v1/vaults/${ID}`, {
          method: "PUT",
          token: TOKEN,
          headers: { "If-Match": '"1"' },
          body: bytes("two"),
        }))!;
        expect(replaced.headers.get("ETag")).toBe('"2"');

        const stale = (await call(store, `/api/v1/vaults/${ID}`, {
          method: "PUT",
          token: TOKEN,
          headers: { "If-Match": '"1"' },
          body: bytes("lost"),
        }))!;
        expect(stale.status).toBe(412);
        expect(stale.headers.get("ETag")).toBe('"2"');

        expect(await (await call(store, `/api/v1/vaults/${ID}`, { token: TOKEN }))!.text()).toBe("two");

        expect((await call(store, `/api/v1/vaults/${ID}`, { method: "DELETE", token: TOKEN }))!.status).toBe(204);
        expect((await call(store, `/api/v1/vaults/${ID}`, { token: TOKEN }))!.status).toBe(404);
      } finally {
        await done();
      }
    });

    it("only lets the token that created a vault open it", async () => {
      const { store, done } = await make();
      try {
        await call(store, `/api/v1/vaults/${ID}`, { method: "PUT", token: TOKEN, headers: { "If-None-Match": "*" }, body: bytes("x") });
        expect((await call(store, `/api/v1/vaults/${ID}`, { token: OTHER }))!.status).toBe(403);
        expect((await call(store, `/api/v1/vaults/${ID}`, { method: "DELETE", token: OTHER }))!.status).toBe(403);
        expect((await call(store, `/api/v1/vaults/${ID}`))!.status).toBe(401);
      } finally {
        await done();
      }
    });

    it("lets exactly one of two simultaneous writers win", async () => {
      const { store, done } = await make();
      try {
        await call(store, `/api/v1/vaults/${ID}`, { method: "PUT", token: TOKEN, headers: { "If-None-Match": "*" }, body: bytes("0") });
        const results = await Promise.all(
          ["a", "b", "c"].map((body) =>
            call(store, `/api/v1/vaults/${ID}`, { method: "PUT", token: TOKEN, headers: { "If-Match": '"1"' }, body: bytes(body) }),
          ),
        );
        expect(results.map((r) => r!.status).sort()).toEqual([200, 412, 412]);
      } finally {
        await done();
      }
    });
  });
}

describe("sync api requests", () => {
  const store = new MemoryStore();

  it("ignores paths outside the API so the host can serve the app", async () => {
    expect(await call(store, "/courses")).toBeNull();
  });

  it("reports health", async () => {
    const response = (await call(store, "/api/v1/health"))!;
    expect(await response.json()).toMatchObject({ ok: true, protocol: 1 });
  });

  it("accepts the path in a route parameter, for hosts that rewrite to one function", async () => {
    const response = (await call(store, "/api/sync?route=health"))!;
    expect(response.status).toBe(200);
  });

  it("validates ids, sizes and preconditions", async () => {
    expect((await call(store, "/api/v1/vaults/nope", { token: TOKEN }))!.status).toBe(400);
    const big = await call(
      store,
      `/api/v1/vaults/${ID}`,
      { method: "PUT", token: TOKEN, headers: { "If-None-Match": "*" }, body: new Uint8Array(20) },
      { maxBytes: 10 },
    );
    expect(big!.status).toBe(413);
    const unconditional = await call(store, `/api/v1/vaults/${ID}`, { method: "PUT", token: TOKEN, body: bytes("x") });
    expect(unconditional!.status).toBe(428);
  });

  it("answers CORS preflight and exposes the ETag", async () => {
    const preflight = (await call(store, `/api/v1/vaults/${ID}`, { method: "OPTIONS", headers: { Origin: "tauri://localhost" } }))!;
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("If-Match");

    const narrowed = (await call(
      store,
      "/api/v1/health",
      { headers: { Origin: "https://evil.example" } },
      optionsFromEnv({ SYNC_ALLOWED_ORIGINS: "https://mine.example, tauri://localhost" }),
    ))!;
    expect(narrowed.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe.skipIf(!redisUrl)("vercel function", () => {
  it("serves the API from the rewritten route, backed by Redis", async () => {
    process.env.KV_REST_API_URL = redisUrl;
    process.env.KV_REST_API_TOKEN = redisToken;
    const vercel = await import("../api/sync");
    const id = "fedcba9876543210fedcba9876543210";
    const put = await vercel.PUT(
      new Request(`${BASE}/api/sync?route=vaults/${id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${TOKEN}`, "If-None-Match": "*" },
        body: bytes("from vercel"),
      }),
    );
    expect([201, 412]).toContain(put.status);
    const get = await vercel.GET(new Request(`${BASE}/api/sync?route=vaults/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } }));
    expect(await get.text()).toBe("from vercel");
    await vercel.DELETE(new Request(`${BASE}/api/sync?route=vaults/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } }));
  });
});

const CHUNK_A = "a".repeat(63) + "1";
const CHUNK_B = "b".repeat(63) + "2";

for (const [name, make] of [
  ["memory", async () => ({ blobs: new MemoryBlobStore() as BlobStore, done: async () => {} })],
  [
    "file",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "oew-blobs-"));
      return { blobs: new FileBlobStore(dir) as BlobStore, done: () => rm(dir, { recursive: true, force: true }) };
    },
  ],
] as const) {
  describe(`course chunks (${name} blob store)`, () => {
    async function setup() {
      const { blobs, done } = await make();
      const store = new MemoryStore();
      const options = { blobs, chunkBytes: 100, quotaBytes: 250 };
      const api = (path: string, init: RequestInit & { token?: string } = {}) =>
        call(store, `/api/v1/vaults/${ID}${path}`, { token: TOKEN, ...init }, options).then((r) => r!);
      await api("", { method: "PUT", headers: { "If-None-Match": "*" }, body: bytes("progress") });
      return { api, blobs, store, options, done };
    }

    it("stores chunks, reports which are missing, and serves them back", async () => {
      const { api, done } = await setup();
      try {
        const query = (ids: string[]) =>
          api("/chunks/query", { method: "POST", body: JSON.stringify({ ids }) }).then((r) => r.json());

        expect(await query([CHUNK_A, CHUNK_B])).toMatchObject({ missing: [CHUNK_A, CHUNK_B], usedBytes: 0, quotaBytes: 250 });
        expect((await api(`/chunks/${CHUNK_A}`, { method: "PUT", body: new Uint8Array(90).fill(7) })).status).toBe(201);
        expect(await query([CHUNK_A, CHUNK_B])).toMatchObject({ missing: [CHUNK_B], usedBytes: 90 });

        const read = await api(`/chunks/${CHUNK_A}`);
        expect(read.headers.get("Cache-Control")).toContain("immutable");
        expect(new Uint8Array(await read.arrayBuffer())).toEqual(new Uint8Array(90).fill(7));
        expect((await api(`/chunks/${CHUNK_B}`)).status).toBe(404);

        expect((await api("/chunks/delete", { method: "POST", body: JSON.stringify({ ids: [CHUNK_A] }) })).status).toBe(204);
        expect((await api(`/chunks/${CHUNK_A}`)).status).toBe(404);
      } finally {
        await done();
      }
    });

    it("enforces the chunk size and the vault's quota", async () => {
      const { api, done } = await setup();
      try {
        // 100-byte chunks plus 64 bytes of allowed overhead.
        expect((await api(`/chunks/${CHUNK_A}`, { method: "PUT", body: new Uint8Array(200) })).status).toBe(413);
        expect((await api(`/chunks/${CHUNK_A}`, { method: "PUT", body: new Uint8Array(150) })).status).toBe(201);
        const over = await api(`/chunks/${CHUNK_B}`, { method: "PUT", body: new Uint8Array(150) });
        expect(over.status).toBe(507);
        expect(await over.json()).toMatchObject({ error: "quota_exceeded", usedBytes: 150 });
        // Replacing a chunk counts only the difference.
        expect((await api(`/chunks/${CHUNK_A}`, { method: "PUT", body: new Uint8Array(150) })).status).toBe(201);
      } finally {
        await done();
      }
    });

    it("guards chunks with the vault's token and removes them with the vault", async () => {
      const { api, blobs, done } = await setup();
      try {
        await api(`/chunks/${CHUNK_A}`, { method: "PUT", body: new Uint8Array(10) });
        expect((await api(`/chunks/${CHUNK_A}`, { token: OTHER })).status).toBe(403);
        expect((await api(`/chunks/not-hex`)).status).toBe(400);

        expect((await api("", { method: "DELETE" })).status).toBe(204);
        expect(await blobs.list(`${ID}/`)).toEqual([]);
      } finally {
        await done();
      }
    });
  });
}

describe("course storage availability", () => {
  it("is advertised in health only when the host has a blob store", async () => {
    const store = new MemoryStore();
    const without = await (await call(store, "/api/v1/health"))!.json();
    expect(without.courses).toBeNull();
    const withBlobs = await (await call(store, "/api/v1/health", {}, { blobs: new MemoryBlobStore() }))!.json();
    expect(withBlobs.courses).toMatchObject({ chunkBytes: 4 * 1024 * 1024 });
  });

  it("refuses chunks when there is no blob store, and before the vault exists", async () => {
    const store = new MemoryStore();
    expect((await call(store, `/api/v1/vaults/${ID}/chunks/${CHUNK_A}`, { token: TOKEN }, { blobs: new MemoryBlobStore() }))!.status).toBe(404);
    await call(store, `/api/v1/vaults/${ID}`, { method: "PUT", token: TOKEN, headers: { "If-None-Match": "*" }, body: bytes("x") });
    expect((await call(store, `/api/v1/vaults/${ID}/chunks/${CHUNK_A}`, { token: TOKEN }))!.status).toBe(501);
  });
});
