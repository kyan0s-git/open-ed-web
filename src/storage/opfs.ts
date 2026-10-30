/**
 * Files on disk, via the Origin Private File System.
 *
 * This is a per-site sandboxed folder the browser gives us — plain files, no server
 * and no database. Course archives live here so they are written once and read by
 * random access, and `progress.json` lives here so it survives a reload even when
 * the user has not bound it to a location of their own.
 */

import { idbDelete, idbDeletePrefix, idbGet, idbPut } from "./idb-files";

const COURSES_DIR = "courses";

export function opfsSupported(): boolean {
  return typeof navigator !== "undefined" && "storage" in navigator && "getDirectory" in navigator.storage;
}

/**
 * Whether files can be written here. Some engines expose the private file system but
 * not writable streams into it (Safari before 26, the WebKit webviews behind the desktop
 * app); those keep the same files in IndexedDB instead. Every function below picks the
 * backend this way, so callers never need to know.
 */
export function opfsWritable(): boolean {
  return (
    opfsSupported() &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  );
}

const archiveKey = (courseId: string) => `${COURSES_DIR}/${courseId}/source.zip`;

async function root(): Promise<FileSystemDirectoryHandle> {
  if (!opfsSupported()) {
    throw new Error("This browser has no Origin Private File System, which open-ed-web needs to store courses.");
  }
  return navigator.storage.getDirectory();
}

async function dir(path: string[], create = false): Promise<FileSystemDirectoryHandle> {
  let handle = await root();
  for (const segment of path) {
    handle = await handle.getDirectoryHandle(segment, { create });
  }
  return handle;
}

/** Ask the browser not to evict our courses under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usageBytes: usage, quotaBytes: quota };
}

/** Stream an archive to disk without ever holding the whole thing in memory. */
export async function writeCourseArchive(courseId: string, source: Blob): Promise<void> {
  if (!opfsWritable()) return idbPut(archiveKey(courseId), source);
  const courseDir = await dir([COURSES_DIR, courseId], true);
  const handle = await courseDir.getFileHandle("source.zip", { create: true });
  const writable = await handle.createWritable();
  try {
    await source.stream().pipeTo(writable, { preventClose: true });
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

export async function readCourseArchive(courseId: string): Promise<Blob> {
  if (!opfsWritable()) {
    const blob = await idbGet(archiveKey(courseId));
    if (!(blob instanceof Blob)) throw new DOMException(`No archive stored for ${courseId}`, "NotFoundError");
    return blob;
  }
  const courseDir = await dir([COURSES_DIR, courseId]);
  const handle = await courseDir.getFileHandle("source.zip");
  return handle.getFile();
}

export async function hasCourseArchive(courseId: string): Promise<boolean> {
  try {
    await readCourseArchive(courseId);
    return true;
  } catch {
    return false;
  }
}

export async function deleteCourseArchive(courseId: string): Promise<void> {
  if (!opfsWritable()) return idbDeletePrefix(`${COURSES_DIR}/${courseId}/`);
  const courses = await dir([COURSES_DIR], true);
  await courses.removeEntry(courseId, { recursive: true }).catch(() => {});
}

/**
 * Write a small file so that a crash mid-write cannot leave a truncated one:
 * the new contents land in a temp file which then replaces the original.
 */
export async function writeFileAtomic(name: string, contents: string): Promise<void> {
  // A single IndexedDB put is already atomic.
  if (!opfsWritable()) return idbPut(name, contents);
  const home = await root();
  // A unique temp name: two writes landing at once must not share a scratch file.
  const temp = `${name}.${crypto.randomUUID()}.tmp`;

  const tempHandle = await home.getFileHandle(temp, { create: true });
  const writable = await tempHandle.createWritable();
  await writable.write(contents);
  await writable.close();

  // move() is not universally available; fall back to copy-then-remove.
  const movable = tempHandle as FileSystemFileHandle & {
    move?: (dest: FileSystemDirectoryHandle | string, name?: string) => Promise<void>;
  };
  if (typeof movable.move === "function") {
    await movable.move(name);
    return;
  }

  const target = await home.getFileHandle(name, { create: true });
  const fallback = await target.createWritable();
  await fallback.write(contents);
  await fallback.close();
  await home.removeEntry(temp).catch(() => {});
}

/** Rename a file, used to set a damaged file aside rather than destroy it. */
export async function renameFile(from: string, to: string): Promise<void> {
  if (!opfsWritable()) {
    const value = await idbGet(from);
    if (value === undefined) throw new DOMException(`${from} not found`, "NotFoundError");
    await idbPut(to, value);
    return idbDelete(from);
  }
  const home = await root();
  const handle = await home.getFileHandle(from);
  const movable = handle as FileSystemFileHandle & {
    move?: (dest: FileSystemDirectoryHandle | string, name?: string) => Promise<void>;
  };

  if (typeof movable.move === "function") {
    await movable.move(to);
    return;
  }

  const contents = await (await handle.getFile()).text();
  const target = await home.getFileHandle(to, { create: true });
  const writable = await target.createWritable();
  await writable.write(contents);
  await writable.close();
  await home.removeEntry(from).catch(() => {});
}

export async function readFileText(name: string): Promise<string | null> {
  try {
    if (!opfsWritable()) {
      const value = await idbGet(name);
      return value === undefined ? null : typeof value === "string" ? value : await value.text();
    }
    const home = await root();
    const handle = await home.getFileHandle(name);
    return (await handle.getFile()).text();
  } catch {
    return null;
  }
}
