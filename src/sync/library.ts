import { useSyncExternalStore } from "react";
import type { LibraryEntry } from "@/storage/progress";
import { progressStore } from "@/storage/progress-store";
import { readCourseArchive } from "@/storage/opfs";
import { listCourses } from "@/storage/db";
import { syncEngine } from "./engine";
import { chunkClient, downloadArchive, uploadArchive, type Transfer } from "./courses";

/**
 * Courses on the sync server: uploading this device's, downloading other devices', and
 * tracking transfers in progress so any screen can show them.
 *
 * All of it is opt-in, per device (Settings → Sync across devices → Store courses on the
 * server), and only offered when the server has course storage turned on.
 *
 * Which courses the server holds is recorded in the progress file's `library`, which
 * sync carries to every device; the server itself only sees anonymous chunks.
 */

export interface CourseRef {
  id: string;
  title: string;
  courseNumber?: string;
}

export interface TransferState extends Transfer {
  kind: "upload" | "download";
  error?: string;
}

const transfers = new Map<string, TransferState>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, TransferState> = new Map();

function setTransfer(courseId: string, state: TransferState | null): void {
  if (state) transfers.set(courseId, state);
  else transfers.delete(courseId);
  snapshot = new Map(transfers);
  for (const listener of listeners) listener();
}

const active = (courseId: string) => {
  const state = transfers.get(courseId);
  return state !== undefined && !state.error;
};

export function useTransfers(): ReadonlyMap<string, TransferState> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** Courses the server holds for this vault, by id. */
export function storedCourses(doc = progressStore.doc): Record<string, LibraryEntry> {
  return Object.fromEntries(Object.entries(doc.library).filter(([, entry]) => !entry.removed));
}

async function connection() {
  if (!syncEngine.courseSettings.enabled) throw new Error("Course storage is turned off on this device.");
  const access = await syncEngine.access();
  if (!access) throw new Error("Turn on sync to store courses on a server.");
  const storage = await syncEngine.courseStorage();
  if (!storage) throw new Error("This sync server does not store courses, only progress.");
  return { ...access, storage, client: chunkClient(access.server, access.keys, access.fetch) };
}

/** Upload a course from this device. Safe to repeat: only missing chunks are sent. */
export async function uploadCourse(course: CourseRef): Promise<void> {
  if (active(course.id)) return;
  setTransfer(course.id, { kind: "upload", phase: "checking", done: 0, total: 1 });
  try {
    const { keys, storage, client } = await connection();
    const archive = await readCourseArchive(course.id);
    const ids = await uploadArchive(archive, {
      client,
      keys,
      chunkBytes: storage.chunkBytes,
      onProgress: (progress) => setTransfer(course.id, { kind: "upload", ...progress }),
    });

    const previous = progressStore.doc.library[course.id];
    const now = new Date().toISOString();
    await progressStore.update(
      (doc) => ({
        ...doc,
        library: {
          ...doc.library,
          [course.id]: {
            title: course.title,
            courseNumber: course.courseNumber ?? "",
            bytes: archive.size,
            chunkBytes: storage.chunkBytes,
            chunks: ids,
            uploadedAt: now,
            removed: false,
            updatedAt: now,
          },
        },
      }),
      { immediate: true },
    );
    // A newer download of the same course replaces the old upload's chunks.
    if (previous) {
      const replaced = previous.chunks.filter((id) => !ids.includes(id));
      await client.remove(unreferenced(replaced, course.id)).catch(() => {});
    }
    await syncEngine.syncNow().catch(() => {});
    setTransfer(course.id, null);
  } catch (error) {
    setTransfer(course.id, { kind: "upload", phase: "uploading", done: 0, total: 1, error: (error as Error).message });
    throw error;
  }
}

/** Download a course stored on the server and import it on this device. */
export async function downloadCourse(courseId: string): Promise<void> {
  const entry = storedCourses()[courseId];
  if (!entry || active(courseId)) return;
  setTransfer(courseId, { kind: "download", phase: "downloading", done: 0, total: entry.bytes });
  try {
    const { keys, client } = await connection();
    const archive = await downloadArchive(entry.chunks, {
      client,
      keys,
      bytes: entry.bytes,
      onProgress: (progress) => setTransfer(courseId, { kind: "download", ...progress }),
    });

    setTransfer(courseId, { kind: "download", phase: "importing", done: 0, total: 1 });
    const [{ runImport }, { evictCourse }, { resetSearch }, { coursesChanged }] = await Promise.all([
      import("@/import/run-import"),
      import("@/routes/useCourse"),
      import("@/search/client"),
      import("@/storage/queries"),
    ]);
    const file = new File([archive], `${entry.courseNumber || entry.title}.zip`, { type: "application/zip" });
    const bundle = await runImport(file, (progress) =>
      setTransfer(courseId, { kind: "download", phase: "importing", done: progress.done, total: progress.total }),
    );
    evictCourse(bundle.course.id);
    resetSearch();
    void import("@/search/pdf-indexer").then(({ indexPdfText }) => indexPdfText());
    setTransfer(courseId, null);
    coursesChanged();
  } catch (error) {
    setTransfer(courseId, { kind: "download", phase: "downloading", done: 0, total: 1, error: (error as Error).message });
    throw error;
  }
}

/** Remove a course from the server, for every device. Copies on devices are kept. */
export async function removeStoredCourse(courseId: string): Promise<void> {
  const entry = progressStore.doc.library[courseId];
  if (!entry || entry.removed) return;
  const { client } = await connection();
  await client.remove(unreferenced(entry.chunks, courseId));
  const now = new Date().toISOString();
  await progressStore.update(
    (doc) => ({
      ...doc,
      library: { ...doc.library, [courseId]: { ...entry, chunks: [], removed: true, updatedAt: now } },
    }),
    { immediate: true },
  );
  await syncEngine.syncNow().catch(() => {});
}

/**
 * Uploads this device has committed to, kept across restarts: an upload runs in the page,
 * so closing or reloading it mid-way would otherwise drop the course silently. Resuming
 * is cheap, because chunks the server already has are skipped.
 */
const PENDING_KEY = "open-ed-web:sync:pending-uploads";

function pendingUploads(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function setPending(courseId: string, pending: boolean): void {
  const ids = new Set(pendingUploads());
  if (pending) ids.add(courseId);
  else ids.delete(courseId);
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable: the upload simply will not resume after a restart.
  }
}

async function uploadPending(course: CourseRef): Promise<void> {
  setPending(course.id, true);
  try {
    await uploadCourse(course);
    setPending(course.id, false);
  } catch (error) {
    // Refusals that a retry will not fix (no room, storage turned off) are not retried.
    const status = (error as { status?: number }).status;
    if ((status !== undefined && (status < 500 || status === 507)) || !syncEngine.courseSettings.enabled) {
      setPending(course.id, false);
    }
  }
}

/** After an import here, upload the course if this device is set to. Never throws. */
export async function uploadAfterImport(course: CourseRef): Promise<void> {
  const settings = syncEngine.courseSettings;
  if (!syncEngine.enabled || !settings.enabled || !settings.autoUpload) return;
  if (!(await syncEngine.courseStorage().catch(() => null))) return;
  await uploadPending(course);
}

/** At start-up, finish uploads an earlier session began. Never throws. */
export async function resumeUploads(): Promise<void> {
  const ids = pendingUploads();
  if (ids.length === 0) return;
  if (!syncEngine.enabled || !syncEngine.courseSettings.enabled) return;
  if (!(await syncEngine.courseStorage().catch(() => null))) return;
  const courses = new Map((await listCourses()).map((course) => [course.id, course]));
  for (const id of ids) {
    const course = courses.get(id);
    if (!course) {
      setPending(id, false); // removed from this device since
      continue;
    }
    await uploadPending({ id: course.id, title: course.title, courseNumber: course.courseNumber });
  }
}

/**
 * Download courses other devices stored, if this device is set to: now, and whenever
 * sync brings in news of another. Courses over the size limit wait for a manual download.
 */
let stopAutoDownload: (() => void) | null = null;

export function startAutoDownload(): () => void {
  // Started from app start-up and again whenever the setting is turned on; once is enough.
  if (stopAutoDownload) return stopAutoDownload;
  const check = async () => {
    const settings = syncEngine.courseSettings;
    if (!syncEngine.enabled || !settings.enabled || !settings.autoDownload) return;
    if (!(await syncEngine.courseStorage().catch(() => null))) return;

    const local = new Set((await listCourses()).map((course) => course.id));
    const limit = settings.autoDownloadMaxMB > 0 ? settings.autoDownloadMaxMB * 1024 * 1024 : Infinity;
    for (const [id, entry] of Object.entries(storedCourses())) {
      if (local.has(id) || transfers.has(id) || entry.bytes > limit) continue;
      // One at a time: these can be hundreds of megabytes.
      await downloadCourse(id).catch(() => {});
    }
  };

  let running: Promise<void> | null = null;
  const run = () => {
    running ??= check().finally(() => (running = null));
  };
  run();
  const unsubscribe = progressStore.subscribe((_doc, source) => {
    if (source === "merge") run();
  });
  const unwatch = syncEngine.subscribe(run);
  stopAutoDownload = () => {
    unsubscribe();
    unwatch();
    stopAutoDownload = null;
  };
  return stopAutoDownload;
}

/** Server usage for this vault, for Settings; null when not available. */
export async function storageUsage(): Promise<{ usedBytes: number; quotaBytes: number } | null> {
  try {
    const { client } = await connection();
    const { usedBytes, quotaBytes } = await client.query([]);
    return { usedBytes, quotaBytes };
  } catch {
    return null;
  }
}

export function clearTransferError(courseId: string): void {
  if (transfers.get(courseId)?.error) setTransfer(courseId, null);
}

/** Of `ids`, the chunks no other stored course uses, which are safe to delete. */
function unreferenced(ids: string[], courseId: string): string[] {
  const inUse = new Set(
    Object.entries(storedCourses())
      .filter(([id]) => id !== courseId)
      .flatMap(([, entry]) => entry.chunks),
  );
  return ids.filter((id) => !inUse.has(id));
}
