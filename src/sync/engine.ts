import { canonicalProgress, parseProgress, serializeProgress, type ProgressDoc } from "@/storage/progress";
import { progressStore, type ProgressStore } from "@/storage/progress-store";
import { deriveKeys, fromBase64Url, newSecret, open, seal, toBase64Url, toHex, type VaultKeys } from "./crypto";
import { buildSyncLink, normalizeServer, readSyncConfig, writeSyncConfig, type SyncConfig } from "./config";

/**
 * Keeps progress.json the same on every device that shares a sync link.
 *
 * The protocol is optimistic and merge-based. A sync reads the vault, merges it into the
 * local document record by record (the same merge as importing a file, so nothing done
 * on either side is lost), and writes the result back only if the vault is missing
 * something. Writes are conditional on the version that was read; if another device
 * wrote in between, the server refuses and this device simply reads and merges again.
 *
 * Each device keeps its own full copy, so the server is a meeting point rather than a
 * source of truth: it can be wiped, moved or offline without losing anything.
 */

export type SyncState = "off" | "idle" | "syncing" | "error";

export interface SyncStatus {
  state: SyncState;
  server: string | null;
  lastSyncedAt: string | null;
  error: string | null;
}

/** After a local change, wait this long for more before uploading. */
const CHANGE_DELAY_MS = 4000;
/** While the app is open, check for changes from other devices this often. */
const POLL_MS = 5 * 60 * 1000;
/** Returning to the app syncs, unless it synced this recently. */
const FOCUS_MIN_GAP_MS = 30 * 1000;
const MAX_ROUNDS = 5;

export class SyncAuthError extends Error {}

interface EngineDeps {
  store?: ProgressStore;
  fetch?: typeof fetch;
  /** Persisted config; defaults to localStorage. */
  load?: () => SyncConfig | null;
  save?: (config: SyncConfig | null) => void;
}

export class SyncEngine {
  readonly #store: ProgressStore;
  readonly #fetch: typeof fetch;
  readonly #load: () => SyncConfig | null;
  readonly #save: (config: SyncConfig | null) => void;

  #config: SyncConfig | null;
  #keys: Promise<VaultKeys> | null = null;
  #status: SyncStatus;
  #listeners = new Set<() => void>();
  #running: Promise<void> | null = null;
  #again = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #detach: (() => void) | null = null;

  constructor(deps: EngineDeps = {}) {
    this.#store = deps.store ?? progressStore;
    this.#fetch = deps.fetch ?? ((...args) => fetch(...args));
    this.#load = deps.load ?? readSyncConfig;
    this.#save = deps.save ?? writeSyncConfig;
    this.#config = this.#load();
    this.#status = {
      state: this.#config ? "idle" : "off",
      server: this.#config?.server ?? null,
      lastSyncedAt: this.#config?.lastSyncedAt ?? null,
      error: null,
    };
  }

  get status(): SyncStatus {
    return this.#status;
  }

  get enabled(): boolean {
    return this.#config !== null;
  }

  /** The link to open on another device to join this vault. */
  get link(): string | null {
    return this.#config ? buildSyncLink(this.#config) : null;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Begin syncing in the background, if this device is set up to. */
  start(): void {
    if (!this.#config || this.#detach) return;
    this.#detach = this.#attach();
    void this.syncNow().catch(() => {});
  }

  stop(): void {
    this.#detach?.();
    this.#detach = null;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Create a new vault on `server` holding this device's progress. */
  async create(server: string): Promise<void> {
    const normalized = normalizeServer(server);
    await this.#checkServer(normalized);
    await this.#use({ server: normalized, secret: toBase64Url(newSecret()) });
  }

  /** Join the vault a sync link points to; this device's progress is merged in. */
  async join(target: Pick<SyncConfig, "server" | "secret">): Promise<void> {
    await this.#checkServer(target.server);
    await this.#use({ server: target.server, secret: target.secret });
  }

  /** Stop syncing on this device. Local progress and the vault are both kept. */
  disconnect(): void {
    this.stop();
    this.#config = null;
    this.#keys = null;
    this.#save(null);
    this.#setStatus({ state: "off", server: null, lastSyncedAt: null, error: null });
  }

  /** Delete the vault from the server, for every device, then stop syncing here. */
  async deleteVault(): Promise<void> {
    if (!this.#config) return;
    const keys = await this.#vaultKeys();
    const response = await this.#request("DELETE", keys);
    if (!response.ok && response.status !== 404) throw await failure(response);
    this.disconnect();
  }

  /** Sync now; concurrent calls share one run, and a call during a run queues another. */
  syncNow(): Promise<void> {
    if (!this.#config) return Promise.resolve();
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }

    this.#running = (async () => {
      try {
        do {
          this.#again = false;
          await this.#syncOnce();
        } while (this.#again);
      } finally {
        this.#running = null;
      }
    })();
    return this.#running;
  }

  async #use(target: Pick<SyncConfig, "server" | "secret">): Promise<void> {
    this.stop();
    this.#config = { server: target.server, secret: target.secret, etag: null, fingerprint: null, lastSyncedAt: null };
    this.#keys = null;
    this.#save(this.#config);
    this.#setStatus({ state: "idle", server: target.server, lastSyncedAt: null, error: null });
    this.#detach = this.#attach();
    await this.syncNow();
  }

  async #syncOnce(): Promise<void> {
    const config = this.#config;
    if (!config) return;
    this.#setStatus({ ...this.#status, state: "syncing" });

    try {
      const keys = await this.#vaultKeys();

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const local = canonicalProgress(this.#store.doc);
        const localFingerprint = await fingerprint(local);
        const known = config.etag && config.fingerprint ? config.etag : null;

        const read = await this.#request("GET", keys, known ? { "If-None-Match": known } : {});

        if (read.status === 304 && known) {
          if (localFingerprint === config.fingerprint) return this.#synced(known, localFingerprint);
          if (await this.#write(keys, this.#store.doc, { "If-Match": known })) return;
          continue;
        }

        if (read.status === 404) {
          if (await this.#write(keys, this.#store.doc, { "If-None-Match": "*" })) return;
          continue;
        }

        if (!read.ok) throw await failure(read);

        const etag = read.headers.get("ETag");
        const remote = parseProgress(await open(keys, new Uint8Array(await read.arrayBuffer())));
        const merged = await this.#store.mergeIn(remote);
        const mergedText = canonicalProgress(merged);

        if (etag && mergedText === canonicalProgress(remote)) {
          return this.#synced(etag, await fingerprint(mergedText));
        }
        if (!etag) throw new Error("The sync server did not return a version for the vault.");
        if (await this.#write(keys, merged, { "If-Match": etag })) return;
      }
      throw new Error("Other devices kept changing the vault; will try again shortly.");
    } catch (error) {
      this.#setStatus({ ...this.#status, state: "error", error: describe(error) });
      throw error;
    }
  }

  /** Upload a document; false when another device wrote first and the caller should re-read. */
  async #write(keys: VaultKeys, doc: ProgressDoc, condition: Record<string, string>): Promise<boolean> {
    const text = canonicalProgress(doc);
    // The vault holds the readable, pretty-printed form, same as the file on disk.
    const body = await seal(keys, serializeProgress(doc));
    const response = await this.#request("PUT", keys, condition, body);
    if (response.status === 412) return false;
    if (!response.ok) throw await failure(response);

    const etag = response.headers.get("ETag");
    if (!etag) throw new Error("The sync server did not return a version for the vault.");
    this.#synced(etag, await fingerprint(text));
    return true;
  }

  #synced(etag: string, print: string): void {
    if (!this.#config) return;
    const now = new Date().toISOString();
    this.#config = { ...this.#config, etag, fingerprint: print, lastSyncedAt: now };
    this.#save(this.#config);
    this.#setStatus({ ...this.#status, state: "idle", lastSyncedAt: now, error: null });
  }

  #request(method: string, keys: VaultKeys, headers: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    const server = this.#config?.server;
    if (!server) throw new Error("Sync is not set up.");
    return this.#fetch(`${server}/api/v1/vaults/${keys.vaultId}`, {
      method,
      headers: {
        Authorization: `Bearer ${keys.token}`,
        ...(body ? { "Content-Type": "application/octet-stream" } : {}),
        ...headers,
      },
      body: body as Uint8Array<ArrayBuffer> | undefined,
      cache: "no-store",
    });
  }

  async #checkServer(server: string): Promise<void> {
    let ok = false;
    try {
      const response = await this.#fetch(`${server}/api/v1/health`, { cache: "no-store" });
      const body = (await response.json()) as { service?: string };
      ok = response.ok && body.service === "open-ed-web-sync";
    } catch {
      ok = false;
    }
    if (!ok) throw new Error(`No open-ed-web sync server answered at ${server}.`);
  }

  #vaultKeys(): Promise<VaultKeys> {
    if (!this.#config) throw new Error("Sync is not set up.");
    this.#keys ??= deriveKeys(fromBase64Url(this.#config.secret));
    return this.#keys;
  }

  /** Background triggers: local changes, returning to the app, coming online, a slow poll. */
  #attach(): () => void {
    const later = (delay: number) => {
      if (this.#timer) return;
      this.#timer = setTimeout(() => {
        this.#timer = null;
        void this.syncNow().catch(() => {});
      }, delay);
    };

    const unsubscribe = this.#store.subscribe((_doc, source) => {
      if (source === "local") later(CHANGE_DELAY_MS);
    });

    if (typeof window === "undefined") return unsubscribe;

    const sinceLast = () => Date.now() - Date.parse(this.#status.lastSyncedAt ?? "0");
    const onVisible = () => {
      if (document.visibilityState === "visible" && sinceLast() > FOCUS_MIN_GAP_MS) void this.syncNow().catch(() => {});
    };
    const onOnline = () => void this.syncNow().catch(() => {});
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void this.syncNow().catch(() => {});
    }, POLL_MS);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      unsubscribe();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }

  #setStatus(status: SyncStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) listener();
  }
}

async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest)).slice(0, 32);
}

async function failure(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (response.status === 401 || response.status === 403) {
    return new SyncAuthError("The server refused this sync link. It may belong to a vault that was deleted.");
  }
  if (response.status === 503) return new Error(body.message ?? "Sync is not configured on this server.");
  return new Error(body.message ?? `The sync server answered ${response.status}.`);
}

function describe(error: unknown): string {
  if (error instanceof TypeError) return "Could not reach the sync server. Changes will sync when it is back.";
  return (error as Error).message ?? String(error);
}

export const syncEngine = new SyncEngine();
