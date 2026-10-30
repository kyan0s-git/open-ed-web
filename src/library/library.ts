import { useSyncExternalStore } from "react";
import type { Course } from "@/content/schema";
import type { LibraryEntry, ProgressDoc } from "@/storage/progress";
import { progressStore } from "@/storage/progress-store";
import { listCourses } from "@/storage/db";
import { readCourseArchive } from "@/storage/opfs";
import { downloadArchive } from "./fetch";

/**
 * The course library: which courses the learner has, on any device.
 *
 * It is a list in the progress file — title, number, and where the archive can be
 * downloaded — so it syncs, encrypted, wherever progress does, and the sync server holds
 * the list but never a course. A device that finds a course in the list that it does not
 * have can download it from its source (for OCW, straight from ocw.mit.edu) and import
 * it, on request or automatically.
 */

// ---------------------------------------------------------------- settings (per device)

const SETTINGS_KEY = "open-ed-web:library";
const SKIP_KEY = "open-ed-web:library:skip";

export interface LibrarySettings {
  /** Download courses from the library that this device does not have. */
  autoDownload: boolean;
  /** Skip automatic downloads larger than this, in megabytes; 0 for no limit. */
  maxMB: number;
}

const DEFAULTS: LibrarySettings = { autoDownload: true, maxMB: 500 };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the setting lasts until the page closes.
  }
}

let settings: LibrarySettings = { ...DEFAULTS, ...readJson<Partial<LibrarySettings>>(SETTINGS_KEY, {}) };

export function librarySettings(): LibrarySettings {
  return settings;
}

export function setLibrarySettings(change: Partial<LibrarySettings>): void {
  settings = { ...settings, ...change };
  writeJson(SETTINGS_KEY, settings);
  notify();
  if (settings.autoDownload) void autoDownload();
}

/**
 * Courses removed from this device only. Automatic downloads leave them alone, so
 * removing a course here does not bring it straight back; a manual download clears it.
 */
function skipped(): Set<string> {
  return new Set(readJson<string[]>(SKIP_KEY, []));
}

function setSkipped(courseId: string, skip: boolean): void {
  const ids = skipped();
  if (skip) ids.add(courseId);
  else ids.delete(courseId);
  writeJson(SKIP_KEY, [...ids]);
}

// ---------------------------------------------------------------- transfers (for the UI)

export interface Transfer {
  phase: "downloading" | "importing";
  done: number;
  total: number | null;
  error?: string;
}

const transfers = new Map<string, Transfer>();
const listeners = new Set<() => void>();
let snapshot = { transfers: new Map(transfers) as ReadonlyMap<string, Transfer>, settings };

function notify(): void {
  snapshot = { transfers: new Map(transfers), settings };
  for (const listener of listeners) listener();
}

function setTransfer(courseId: string, transfer: Transfer | null): void {
  if (transfer) transfers.set(courseId, transfer);
  else transfers.delete(courseId);
  notify();
}

/** Downloads in progress and this device's library settings, for rendering. */
export function useLibraryState(): typeof snapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

// ---------------------------------------------------------------- the list

/** Courses in the library, by id. */
export function libraryEntries(doc: ProgressDoc = progressStore.doc): Record<string, LibraryEntry> {
  return Object.fromEntries(Object.entries(doc.library).filter(([, entry]) => !entry.removed));
}

/** Add a course this device has imported, or refresh its entry. */
export async function recordCourse(course: Course, bytes: number | null): Promise<void> {
  const existing = progressStore.doc.library[course.id];
  const sourceUrl = course.downloadUrl ?? existing?.sourceUrl ?? null;
  const unchanged =
    existing &&
    !existing.removed &&
    existing.title === course.title &&
    existing.sourceUrl === sourceUrl &&
    (bytes === null || existing.bytes === bytes);
  setSkipped(course.id, false);
  if (unchanged) return;

  const now = new Date().toISOString();
  await progressStore.update(
    (doc) => ({
      ...doc,
      library: {
        ...doc.library,
        [course.id]: {
          title: course.title,
          courseNumber: course.courseNumber ?? "",
          sourceUrl,
          bytes: bytes ?? existing?.bytes ?? null,
          addedAt: existing && !existing.removed ? existing.addedAt : now,
          removed: false,
          updatedAt: now,
        },
      },
    }),
    { immediate: true },
  );
}

/**
 * Courses imported before the library existed have no entry yet; add them, so the list
 * reflects everything on this device. Cheap when there is nothing to do.
 */
export async function backfillLibrary(): Promise<void> {
  const library = progressStore.doc.library;
  for (const course of await listCourses()) {
    if (library[course.id]) continue;
    const archive = await readCourseArchive(course.id).catch(() => null);
    let withUrl = course;
    if (!course.downloadUrl && archive) {
      // Imported before download URLs were recorded: read them from the archive.
      const [{ Archive }, { detectFormat }, { ocwDownloadUrl }] = await Promise.all([
        import("@/import/zip"),
        import("@/import/detect"),
        import("@/import/ocw-hugo-json"),
      ]);
      const zip = await Archive.open(archive).catch(() => null);
      if (zip) {
        const data = await zip.json<{ site_url_path?: string; site_short_id?: string }>(`${detectFormat(zip).base}data.json`).catch(() => null);
        withUrl = { ...course, downloadUrl: data ? ocwDownloadUrl(data) : undefined };
        await zip.close().catch(() => {});
      }
    }
    await recordCourse(withUrl, archive?.size ?? null);
  }
}

/** Remove a course from the library, for every device. Copies already on devices stay. */
export async function removeFromLibrary(courseId: string): Promise<void> {
  const entry = progressStore.doc.library[courseId];
  if (!entry || entry.removed) return;
  const now = new Date().toISOString();
  await progressStore.update(
    (doc) => ({ ...doc, library: { ...doc.library, [courseId]: { ...entry, removed: true, updatedAt: now } } }),
    { immediate: true },
  );
}

/** Note that a course was removed from this device only, so it is not downloaded again. */
export function removedOnThisDevice(courseId: string): void {
  setSkipped(courseId, true);
}

// ---------------------------------------------------------------- downloading

/** Download a course in the library from its source and import it here. */
export async function downloadCourse(courseId: string): Promise<void> {
  const entry = libraryEntries()[courseId];
  if (!entry?.sourceUrl) throw new Error("This course has no download address; import its .zip on this device.");
  if (transfers.has(courseId) && !transfers.get(courseId)!.error) return;

  setSkipped(courseId, false);
  setTransfer(courseId, { phase: "downloading", done: 0, total: entry.bytes });
  try {
    const archive = await downloadArchive(entry.sourceUrl, (progress) =>
      setTransfer(courseId, { phase: "downloading", done: progress.done, total: progress.total ?? entry.bytes }),
    );

    setTransfer(courseId, { phase: "importing", done: 0, total: 1 });
    const [{ runImport }, { evictCourse }, { resetSearch }, { coursesChanged }] = await Promise.all([
      import("@/import/run-import"),
      import("@/routes/useCourse"),
      import("@/search/client"),
      import("@/storage/queries"),
    ]);
    const file = new File([archive], `${entry.courseNumber || entry.title}.zip`, { type: "application/zip" });
    const bundle = await runImport(file, (progress) =>
      setTransfer(courseId, { phase: "importing", done: progress.done, total: progress.total }),
    );
    if (bundle.course.id !== courseId) {
      // A different course now lives at that address. Keep it, but do not try again.
      setSkipped(courseId, true);
      throw new Error(`${entry.sourceUrl} now holds a different course (${bundle.course.title}).`);
    }

    evictCourse(courseId);
    resetSearch();
    void import("@/search/pdf-indexer").then(({ indexPdfText }) => indexPdfText());
    await recordCourse(bundle.course, archive.size);
    setTransfer(courseId, null);
    coursesChanged();
  } catch (error) {
    setTransfer(courseId, { phase: "downloading", done: 0, total: null, error: (error as Error).message });
    throw error;
  }
}

export function dismissError(courseId: string): void {
  if (transfers.get(courseId)?.error) setTransfer(courseId, null);
}

/** Courses in the library that this device does not have. */
export async function missingCourses(): Promise<[string, LibraryEntry][]> {
  const local = new Set((await listCourses()).map((course) => course.id));
  return Object.entries(libraryEntries()).filter(([id]) => !local.has(id));
}

let running: Promise<void> | null = null;

/**
 * Download what this device is missing, if it is set to: one course at a time, skipping
 * courses removed here, courses without a source, and courses over the size limit.
 */
export function autoDownload(): Promise<void> {
  running ??= (async () => {
    try {
      if (!settings.autoDownload) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const limit = settings.maxMB > 0 ? settings.maxMB * 1024 * 1024 : Infinity;
      const skip = skipped();
      for (const [id, entry] of await missingCourses()) {
        if (skip.has(id) || transfers.has(id) || !entry.sourceUrl) continue;
        if ((entry.bytes ?? 0) > limit) continue;
        await downloadCourse(id).catch(() => {});
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

let watching = false;

/** Keep the library current: record this device's courses, then fetch what others added. */
export function startLibrary(): void {
  if (watching) return;
  watching = true;
  void backfillLibrary()
    .catch(() => {})
    .then(() => autoDownload());
  progressStore.subscribe((_doc, source) => {
    if (source === "merge") void autoDownload();
  });
  if (typeof window !== "undefined") window.addEventListener("online", () => void autoDownload());
}
