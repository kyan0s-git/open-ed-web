import type { Archive } from "@/import/zip";
import { openStoredArchive } from "@/import/pipeline";

/**
 * Serves files out of the stored archive on demand.
 *
 * Assets are never unpacked at import time: a course keeps one copy of itself as the
 * archive, and a PDF or image becomes a blob URL only when something asks to display
 * it. Blob URLs are cached and revoked on eviction, since each one pins its bytes in
 * memory until released.
 */

const MAX_CACHED_ASSETS = 24;

const archives = new Map<string, Promise<Archive>>();
const urls = new Map<string, string>();

function archiveFor(courseId: string): Promise<Archive> {
  let archive = archives.get(courseId);
  if (!archive) {
    archive = openStoredArchive(courseId);
    archives.set(courseId, archive);
  }
  return archive;
}

/** Read one file out of a stored course archive. */
export async function readAsset(courseId: string, zipPath: string, mime?: string): Promise<Blob> {
  return (await archiveFor(courseId)).blob(zipPath, mime);
}

export async function assetUrl(
  courseId: string,
  zipPath: string,
  mime = "application/octet-stream",
): Promise<string> {
  const key = `${courseId}::${zipPath}`;
  const cached = urls.get(key);
  if (cached) {
    // Refresh recency so the least recently used entry is the one evicted.
    urls.delete(key);
    urls.set(key, cached);
    return cached;
  }

  const archive = await archiveFor(courseId);
  const url = URL.createObjectURL(await archive.blob(zipPath, mime));
  urls.set(key, url);

  while (urls.size > MAX_CACHED_ASSETS) {
    const [oldestKey, oldestUrl] = urls.entries().next().value as [string, string];
    urls.delete(oldestKey);
    URL.revokeObjectURL(oldestUrl);
  }

  return url;
}

/** Release everything held for a course, e.g. when it is deleted. */
export async function releaseCourse(courseId: string): Promise<void> {
  for (const [key, url] of urls) {
    if (key.startsWith(`${courseId}::`)) {
      URL.revokeObjectURL(url);
      urls.delete(key);
    }
  }

  const archive = archives.get(courseId);
  archives.delete(courseId);
  if (archive) await (await archive).close().catch(() => {});
}
