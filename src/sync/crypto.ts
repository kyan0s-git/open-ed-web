/**
 * End-to-end encryption for synced progress.
 *
 * Everything starts from one random 256-bit secret, created on the first device and
 * carried to others in the sync link. From it each device derives, with HKDF:
 *
 *  - the vault id, which addresses the vault on the server;
 *  - the access token, which the server checks (it stores only a hash of it);
 *  - the AES-256-GCM key, which never leaves the device.
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

  const [id, token, key] = await Promise.all([
    crypto.subtle.deriveBits(params("vault-id"), base, 128),
    crypto.subtle.deriveBits(params("access-token"), base, 256),
    crypto.subtle.deriveKey(params("encryption-key"), base, { name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  ]);
  return { vaultId: toHex(new Uint8Array(id)), token: toHex(new Uint8Array(token)), key };
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
