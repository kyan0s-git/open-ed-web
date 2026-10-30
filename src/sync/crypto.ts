/**
 * End-to-end encryption for synced progress.
 *
 * Everything starts from one random 256-bit secret, created on the first device and
 * carried to others in the sync link. From it each device derives, with HKDF:
 *
 *  - the vault id, which addresses the vault on the server;
 *  - the access token, which the server checks (it stores only a hash of it);
 *  - the AES-256-GCM key, which never leaves the device;
 *  - for stored courses, a second AES key and an HMAC key that names each chunk.
 *
 * The server therefore holds ciphertext it cannot read, under an id that reveals
 * nothing, and cannot link a vault to a person. Losing the secret loses access to the
 * vault, not the progress: every device keeps its own full copy.
 */

const SALT = new TextEncoder().encode("open-ed-web/sync/v1");
const MAGIC = [0x4f, 0x45, 0x57]; // "OEW"
const FORMAT = 1;
const FLAG_GZIP = 1;
const HEADER_BYTES = 5;
const IV_BYTES = 12;

export const SECRET_BYTES = 32;

export interface VaultKeys {
  vaultId: string;
  token: string;
  key: CryptoKey;
  /** Encrypts course chunks. */
  chunkKey: CryptoKey;
  /** Names course chunks by a keyed hash of their contents. */
  chunkIdKey: CryptoKey;
}

export function newSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

export async function deriveKeys(secret: Uint8Array): Promise<VaultKeys> {
  if (secret.length !== SECRET_BYTES) throw new Error("A sync secret is 32 bytes.");
  const base = await crypto.subtle.importKey("raw", secret as Uint8Array<ArrayBuffer>, "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ]);
  const params = (info: string): HkdfParams => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: SALT,
    info: new TextEncoder().encode(info),
  });

  const aes = (info: string) =>
    crypto.subtle.deriveKey(params(info), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const [id, token, key, chunkKey, chunkIdKey] = await Promise.all([
    crypto.subtle.deriveBits(params("vault-id"), base, 128),
    crypto.subtle.deriveBits(params("access-token"), base, 256),
    aes("encryption-key"),
    aes("chunk-key"),
    crypto.subtle.deriveKey(params("chunk-id"), base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]),
  ]);
  return { vaultId: toHex(new Uint8Array(id)), token: toHex(new Uint8Array(token)), key, chunkKey, chunkIdKey };
}

/** Compress (where the platform can) and encrypt. The vault id is bound in as associated data. */
export async function seal(keys: VaultKeys, plaintext: string): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(plaintext);
  const compressed = await gzip(raw);
  const header = new Uint8Array([...MAGIC, FORMAT, compressed ? FLAG_GZIP : 0]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(header, keys.vaultId) },
    keys.key,
    (compressed ?? raw) as Uint8Array<ArrayBuffer>,
  );

  const out = new Uint8Array(HEADER_BYTES + IV_BYTES + ciphertext.byteLength);
  out.set(header, 0);
  out.set(iv, HEADER_BYTES);
  out.set(new Uint8Array(ciphertext), HEADER_BYTES + IV_BYTES);
  return out;
}

export class SealError extends Error {}

export async function open(keys: VaultKeys, sealed: Uint8Array): Promise<string> {
  if (sealed.length < HEADER_BYTES + IV_BYTES || MAGIC.some((byte, i) => sealed[i] !== byte)) {
    throw new SealError("The synced data is not in a format this app understands.");
  }
  if (sealed[3] !== FORMAT) {
    throw new SealError("The synced data was written by a newer version of open-ed-web. Update this app to sync.");
  }

  const header = sealed.slice(0, HEADER_BYTES);
  const iv = sealed.slice(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: associatedData(header, keys.vaultId) },
      keys.key,
      sealed.slice(HEADER_BYTES + IV_BYTES),
    );
  } catch {
    throw new SealError("The synced data could not be decrypted with this sync link.");
  }

  const bytes = (sealed[4]! & FLAG_GZIP) !== 0 ? await gunzip(new Uint8Array(plain)) : new Uint8Array(plain);
  return new TextDecoder().decode(bytes);
}

const CHUNK_FORMAT = 1;

/**
 * Course chunks are encrypted deterministically: the id is an HMAC of the plaintext and
 * the IV is taken from it, so the same chunk always encrypts to the same bytes under the
 * same name. That is what lets a device skip chunks the server already has, from this or
 * any other device in the vault. It reveals only that two chunks are identical, and an
 * IV can only repeat for identical plaintext.
 */
export async function chunkId(keys: VaultKeys, plain: Uint8Array): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", keys.chunkIdKey, plain as Uint8Array<ArrayBuffer>);
  return toHex(new Uint8Array(mac));
}

export async function sealChunk(keys: VaultKeys, id: string, plain: Uint8Array): Promise<Uint8Array> {
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: chunkIv(id), additionalData: chunkAad(keys, id) },
    keys.chunkKey,
    plain as Uint8Array<ArrayBuffer>,
  );
  const out = new Uint8Array(1 + cipher.byteLength);
  out[0] = CHUNK_FORMAT;
  out.set(new Uint8Array(cipher), 1);
  return out;
}

/** Decrypt a chunk and check it is the one that was asked for. */
export async function openChunk(keys: VaultKeys, id: string, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed[0] !== CHUNK_FORMAT) throw new SealError("A stored course chunk is in a format this app does not understand.");
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: chunkIv(id), additionalData: chunkAad(keys, id) },
        keys.chunkKey,
        sealed.slice(1),
      ),
    );
  } catch {
    throw new SealError("A stored course chunk is damaged or belongs to another vault.");
  }
  if ((await chunkId(keys, plain)) !== id) throw new SealError("A stored course chunk does not match its name.");
  return plain;
}

function chunkIv(id: string): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(IV_BYTES);
  for (let i = 0; i < IV_BYTES; i++) iv[i] = parseInt(id.slice(i * 2, i * 2 + 2), 16);
  return iv;
}

function chunkAad(keys: VaultKeys, id: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${keys.vaultId}/${id}`);
}

function associatedData(header: Uint8Array, vaultId: string): Uint8Array<ArrayBuffer> {
  const id = new TextEncoder().encode(vaultId);
  const out = new Uint8Array(header.length + id.length);
  out.set(header, 0);
  out.set(id, header.length);
  return out;
}

/** gzip when CompressionStream exists (all current browsers and webviews); null otherwise. */
async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== "function") return null;
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new SealError("This browser cannot decompress synced data.");
  }
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
