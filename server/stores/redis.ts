import type { VaultRecord, VaultStore } from "../core";

/**
 * Vaults in Redis, over Upstash's REST API — what Vercel's Marketplace provisions now
 * that Vercel KV is gone, and usable from any host that can make HTTPS requests.
 *
 * Each vault is a hash. Writes run as Lua scripts so the version check and the write
 * happen atomically on the Redis server.
 */

const CREATE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'version', ARGV[1], 'token_hash', ARGV[2], 'data', ARGV[3], 'updated_at', ARGV[4])
return 1`;

const UPDATE = `
if redis.call('HGET', KEYS[1], 'version') ~= ARGV[5] then return 0 end
redis.call('HSET', KEYS[1], 'version', ARGV[1], 'token_hash', ARGV[2], 'data', ARGV[3], 'updated_at', ARGV[4])
return 1`;

export interface RedisRestConfig {
  url: string;
  token: string;
  /** Prefix for keys, so the database can be shared with other things. */
  prefix?: string;
  fetch?: typeof fetch;
}

/**
 * Accepts either naming of the connection variables: UPSTASH_REDIS_REST_* (Upstash's
 * own) or KV_REST_API_* (what Vercel's integration injects).
 */
export function redisConfigFromEnv(env: Record<string, string | undefined>): RedisRestConfig | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? { url, token, prefix: env.SYNC_KEY_PREFIX } : null;
}

export class RedisRestStore implements VaultStore {
  readonly #fetch: typeof fetch;

  constructor(private readonly config: RedisRestConfig) {
    this.#fetch = config.fetch ?? fetch;
  }

  async get(id: string): Promise<VaultRecord | null> {
    const fields = (await this.#command(["HGETALL", this.#key(id)])) as string[] | null;
    if (!fields || fields.length === 0) return null;
    const map = new Map<string, string>();
    for (let i = 0; i + 1 < fields.length; i += 2) map.set(fields[i]!, fields[i + 1]!);
    return {
      version: Number(map.get("version")),
      tokenHash: map.get("token_hash") ?? "",
      data: base64ToBytes(map.get("data") ?? ""),
      updatedAt: Number(map.get("updated_at")),
    };
  }

  async create(id: string, record: VaultRecord): Promise<boolean> {
    return (await this.#command(["EVAL", CREATE, "1", this.#key(id), ...args(record)])) === 1;
  }

  async update(id: string, expectedVersion: number, record: VaultRecord): Promise<boolean> {
    const result = await this.#command(["EVAL", UPDATE, "1", this.#key(id), ...args(record), String(expectedVersion)]);
    return result === 1;
  }

  async delete(id: string): Promise<void> {
    await this.#command(["DEL", this.#key(id)]);
  }

  #key(id: string): string {
    return `${this.config.prefix ?? "openedweb:vault:"}${id}`;
  }

  async #command(command: string[]): Promise<unknown> {
    const response = await this.#fetch(this.config.url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    const body = (await response.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!response.ok || body.error) throw new Error(`Redis ${command[0]} failed: ${body.error ?? response.status}`);
    return body.result;
  }
}

function args(record: VaultRecord): string[] {
  return [String(record.version), record.tokenHash, bytesToBase64(record.data), String(record.updatedAt)];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
