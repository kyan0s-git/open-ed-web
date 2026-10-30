// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handleApi } from "../../server/core";
import { MemoryStore } from "../../server/stores/memory";
import { ProgressStore } from "@/storage/progress-store";
import { emptyProgress, type ProgressDoc } from "@/storage/progress";
import { deriveKeys, newSecret, open, seal } from "./crypto";
import { buildSyncLink, parseSyncLink, type SyncConfig } from "./config";
import { SyncEngine } from "./engine";

const SERVER = "https://sync.test";

/** A fetch that answers from an in-memory sync server, as a real one would. */
function fakeServer() {
  const store = new MemoryStore();
  const requests: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(`${request.method} ${new URL(request.url).pathname.split("/").slice(3, 4).join("")}`);
    return (await handleApi(request, store)) ?? new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { store, fetcher, requests };
}

/** A device: its own progress store, kept in memory, and its own sync config. */
function device(fetcher: typeof fetch) {
  const store = new ProgressStore();
  // Writes go to OPFS in the browser; here they only need to not fail.
  (store as unknown as { flush: () => Promise<void> }).flush = async () => {};
  let config: SyncConfig | null = null;
  const engine = new SyncEngine({ store, fetch: fetcher, load: () => config, save: (next) => (config = next) });
  return { store, engine, config: () => config };
}

function rate(store: ProgressStore, course: string, skill: string, level: number, at: string): Promise<void> {
  return store.update((doc: ProgressDoc) => ({
    ...doc,
    courses: {
      ...doc.courses,
      [course]: {
        title: course,
        items: doc.courses[course]?.items ?? {},
        skills: { ...doc.courses[course]?.skills, [skill]: { level, due: null, reps: 1, lapses: 0, fsrs: null, updatedAt: at } },
        attempts: [],
        notes: {},
        updatedAt: at,
      },
    },
  }));
}

describe("sync crypto", () => {
  it("derives the same vault from the same secret, and round-trips data", async () => {
    const secret = newSecret();
    const a = await deriveKeys(secret);
    const b = await deriveKeys(secret);
    expect(a.vaultId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(b.vaultId).toBe(a.vaultId);

    const sealed = await seal(a, "hello progress");
    expect(new TextDecoder().decode(sealed)).not.toContain("hello");
    expect(await open(b, sealed)).toBe("hello progress");
  });

  it("refuses data sealed under another secret", async () => {
    const sealed = await seal(await deriveKeys(newSecret()), "secret");
    await expect(open(await deriveKeys(newSecret()), sealed)).rejects.toThrow(/could not be decrypted/);
  });
});

describe("sync links", () => {
  it("carry the server and the secret, in the fragment", () => {
    const config = { server: "https://api.example", secret: "A".repeat(43) };
    const link = buildSyncLink(config);
    expect(link).toContain("#k=");
    expect(link.split("#")[0]).not.toContain(config.secret);
    expect(parseSyncLink(link)).toEqual(config);
  });

  it("reject a truncated secret", () => {
    expect(() => parseSyncLink("https://x.example/pair#k=abc")).toThrow(/not a complete sync link/);
  });
});

describe("sync engine", () => {
  it("brings two devices to the same progress without losing either side's work", async () => {
    const { fetcher } = fakeServer();
    const laptop = device(fetcher);
    const phone = device(fetcher);

    await rate(laptop.store, "c1", "s1", 2, "2026-10-01T10:00:00.000Z");
    await laptop.engine.create(SERVER);

    // The phone has its own history before it joins.
    await rate(phone.store, "c1", "s2", 3, "2026-10-02T10:00:00.000Z");
    await phone.engine.join(laptop.config()!);

    expect(Object.keys(phone.store.doc.courses.c1!.skills).sort()).toEqual(["s1", "s2"]);

    await laptop.engine.syncNow();
    expect(Object.keys(laptop.store.doc.courses.c1!.skills).sort()).toEqual(["s1", "s2"]);

    // A later change on one side wins on the other.
    await rate(laptop.store, "c1", "s2", 4, "2026-10-03T10:00:00.000Z");
    await laptop.engine.syncNow();
    await phone.engine.syncNow();
    expect(phone.store.doc.courses.c1!.skills.s2!.level).toBe(4);
  });

  it("does not upload when nothing changed", async () => {
    const { fetcher, requests } = fakeServer();
    const laptop = device(fetcher);
    await rate(laptop.store, "c1", "s1", 1, "2026-10-01T10:00:00.000Z");
    await laptop.engine.create(SERVER);

    requests.length = 0;
    await laptop.engine.syncNow();
    expect(requests.filter((r) => r.startsWith("PUT"))).toEqual([]);
  });

  it("recovers when another device writes between its read and its write", async () => {
    const server = fakeServer();
    const laptop = device(server.fetcher);
    await laptop.engine.create(SERVER);

    // The phone's fetch lets the laptop sneak a write in right after the phone reads.
    let interfered = false;
    const racing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await server.fetcher(input, init);
      if (!interfered && (init?.method ?? "GET") === "GET" && String(input).includes("/vaults/")) {
        interfered = true;
        await rate(laptop.store, "c1", "from-laptop", 2, "2026-10-05T00:00:00.000Z");
        await laptop.engine.syncNow();
      }
      return response;
    }) as typeof fetch;

    const phone = device(racing);
    await rate(phone.store, "c1", "from-phone", 2, "2026-10-04T00:00:00.000Z");
    await phone.engine.join(laptop.config()!);
    await laptop.engine.syncNow();

    for (const side of [phone, laptop]) {
      expect(Object.keys(side.store.doc.courses.c1!.skills).sort()).toEqual(["from-laptop", "from-phone"]);
    }
  });

  it("reports a server that is not a sync server", async () => {
    const laptop = device((async () => new Response("<html>", { status: 200 })) as typeof fetch);
    await expect(laptop.engine.create("https://example.com")).rejects.toThrow(/No open-ed-web sync server/);
    expect(laptop.config()).toBeNull();
  });

  it("starts empty-handed devices from the vault", async () => {
    const { fetcher } = fakeServer();
    const laptop = device(fetcher);
    await rate(laptop.store, "c9", "s", 3, "2026-10-01T00:00:00.000Z");
    await laptop.engine.create(SERVER);

    const fresh = device(fetcher);
    expect(fresh.store.doc).toMatchObject({ courses: emptyProgress().courses });
    await fresh.engine.join(laptop.config()!);
    expect(fresh.store.doc.courses.c9!.skills.s!.level).toBe(3);
  });
});
