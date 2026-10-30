import { isDesktopApp } from "@/desktop";
import { fromBase64Url, SECRET_BYTES, toBase64Url } from "./crypto";

/**
 * Where this device syncs to, kept in localStorage.
 *
 * Deliberately tiny and dependency-free: the app shell reads it at startup to decide
 * whether to load the sync engine at all, and a device that never turns sync on never
 * downloads it.
 */

const KEY = "open-ed-web:sync";

export interface SyncConfig {
  /** Base URL of the sync server; the API lives under /api/v1. */
  server: string;
  /** The vault secret, base64url. */
  secret: string;
  /** The vault version this device last saw, and a fingerprint of what it held. */
  etag?: string | null;
  fingerprint?: string | null;
  lastSyncedAt?: string | null;
}

export function readSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const config = JSON.parse(raw) as SyncConfig;
    return typeof config.server === "string" && typeof config.secret === "string" ? config : null;
  } catch {
    return null;
  }
}

export function writeSyncConfig(config: SyncConfig | null): void {
  try {
    if (config) localStorage.setItem(KEY, JSON.stringify(config));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage disabled: sync simply will not persist across restarts.
  }
}

/**
 * The server this build suggests. A web deployment usually hosts the API itself, so it
 * is the page's own origin; the desktop app has no origin of its own and uses the one
 * baked in at build time (VITE_SYNC_SERVER), if any.
 */
export function defaultServer(): string {
  const configured = (import.meta.env.VITE_SYNC_SERVER as string | undefined)?.trim();
  if (configured) return normalizeServer(configured);
  if (isDesktopApp() || typeof location === "undefined") return "";
  return location.origin;
}

export function normalizeServer(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/**
 * A sync link carries everything another device needs: where the server is and the
 * vault secret. The secret sits in the fragment (after #), which browsers never send to
 * any server, so opening the link does not leak it to whoever hosts the page.
 *
 *   https://your.site/pair#k=<secret>            when the site hosts the API
 *   https://your.site/pair#k=<secret>&s=<server> when the API lives elsewhere
 */
export function buildSyncLink(config: Pick<SyncConfig, "server" | "secret">): string {
  const app = appUrl(config.server);
  const params = new URLSearchParams({ k: config.secret });
  if (new URL(app).origin !== config.server) params.set("s", config.server);
  return `${app}pair#${params}`;
}

function appUrl(server: string): string {
  // On the web, the link should open this same site. The desktop app has no public
  // address, so it points at the server, which serves the web app in every supported
  // deployment.
  if (!isDesktopApp() && typeof location !== "undefined" && /^https?:$/.test(location.protocol)) {
    return `${location.origin}${import.meta.env.BASE_URL}`;
  }
  return `${server}/`;
}

/** Accepts a full sync link or just its fragment. */
export function parseSyncLink(input: string): Pick<SyncConfig, "server" | "secret"> {
  const text = input.trim();
  const hashAt = text.indexOf("#");
  const fragment = hashAt >= 0 ? text.slice(hashAt + 1) : text;
  const params = new URLSearchParams(fragment);
  const secret = params.get("k") ?? "";

  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(secret);
  } catch {
    bytes = new Uint8Array();
  }
  if (bytes.length !== SECRET_BYTES) throw new Error("That is not a complete sync link.");

  let server = params.get("s");
  if (!server && hashAt >= 0 && /^https?:\/\//i.test(text)) server = new URL(text.slice(0, hashAt)).origin;
  if (!server) server = defaultServer();
  if (!server) throw new Error("That sync link does not say which server to use.");

  return { server: normalizeServer(server), secret: toBase64Url(bytes) };
}
