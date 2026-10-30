import { useSyncExternalStore } from "react";
import { isDesktopApp } from "@/desktop";

/**
 * Automatic updates for the desktop app.
 *
 * Releases publish a signed `latest.json` beside the installers; the app checks it at
 * start-up and every few hours, downloads a newer version in the background, verifies its
 * signature against the public key built into the app, and offers to restart into it.
 * Builds made without an update key (forks that have not set one up, local builds) skip
 * all of this: `__UPDATES__` is false and nothing here loads.
 *
 * The web app needs none of it: a reload always fetches the latest deployment.
 */

declare const __APP_VERSION__: string;
declare const __UPDATES__: boolean;

/** The version of this build; on desktop, see appVersion() for the installed binary's. */
export const APP_VERSION = __APP_VERSION__;

let installed: Promise<string> | null = null;

/** The version actually running: the desktop binary's own, else this build's. */
export function appVersion(): Promise<string> {
  installed ??= isDesktopApp()
    ? (window as unknown as { __TAURI_INTERNALS__: { invoke<T>(cmd: string): Promise<T> } }).__TAURI_INTERNALS__
        .invoke<string>("plugin:app|version")
        .catch(() => APP_VERSION)
    : Promise.resolve(APP_VERSION);
  return installed;
}

export function updatesAvailable(): boolean {
  return __UPDATES__ && isDesktopApp();
}

export type UpdateState =
  | { kind: "idle"; checkedAt: string | null }
  | { kind: "checking" }
  | { kind: "downloading"; version: string; done: number; total: number | null }
  | { kind: "ready"; version: string; notes: string | null }
  | { kind: "error"; message: string };

const SETTINGS_KEY = "open-ed-web:updates";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

interface UpdateSettings {
  /** Download new versions in the background without asking first. */
  auto: boolean;
}

function readSettings(): UpdateSettings {
  try {
    return { auto: true, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<UpdateSettings>) };
  } catch {
    return { auto: true };
  }
}

let state: UpdateState = { kind: "idle", checkedAt: null };
let settings = readSettings();
let available: { version: string; notes: string | null; install: () => Promise<void> } | null = null;
interface Snapshot {
  state: UpdateState;
  settings: UpdateSettings;
  /** A newer version that was found, whether or not it is downloaded yet. */
  offered: string | null;
}
let snapshot: Snapshot = { state, settings, offered: null };
const listeners = new Set<() => void>();

function set(next: UpdateState): void {
  state = next;
  snapshot = { state, settings, offered: available?.version ?? null };
  for (const listener of listeners) listener();
}

export function useUpdates(): Snapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

export function setAutoUpdate(auto: boolean): void {
  settings = { ...settings, auto };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not persisted; applies until the app closes.
  }
  set(state);
  if (auto && available && state.kind === "idle") void download();
}

/** Look for a newer version; with automatic updates on, start downloading it. */
export async function checkForUpdate(): Promise<void> {
  if (!updatesAvailable() || state.kind === "checking" || state.kind === "downloading" || state.kind === "ready") return;
  set({ kind: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      available = null;
      set({ kind: "idle", checkedAt: new Date().toISOString() });
      return;
    }

    let total: number | null = null;
    let done = 0;
    available = {
      version: update.version,
      notes: update.body ?? null,
      install: async () => {
        set({ kind: "downloading", version: update.version, done: 0, total: null });
        await update.download((event) => {
          if (event.event === "Started") total = event.data.contentLength ?? null;
          if (event.event === "Progress") done += event.data.chunkLength;
          set({ kind: "downloading", version: update.version, done, total });
        });
        set({ kind: "ready", version: update.version, notes: update.body ?? null });
        installNow = () => update.install();
      },
    };
    set({ kind: "idle", checkedAt: new Date().toISOString() });
    if (settings.auto) await download();
  } catch (error) {
    set({ kind: "error", message: (error as Error).message ?? String(error) });
  }
}

let installNow: (() => Promise<void>) | null = null;

/** Download the update that was found. */
export async function download(): Promise<void> {
  if (!available) return;
  try {
    await available.install();
  } catch (error) {
    set({ kind: "error", message: (error as Error).message ?? String(error) });
  }
}

/** Install the downloaded update and restart into it. Progress is saved first. */
export async function restartToUpdate(): Promise<void> {
  if (!installNow) return;
  const [{ progressStore }, { relaunch }] = await Promise.all([
    import("@/storage/progress-store"),
    import("@tauri-apps/plugin-process"),
  ]);
  await progressStore.flush();
  await installNow();
  await relaunch();
}

let started = false;

/** Check shortly after start-up and then every few hours. */
export function startUpdates(): void {
  if (started || !updatesAvailable()) return;
  started = true;
  setTimeout(() => void checkForUpdate(), 10_000);
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}
