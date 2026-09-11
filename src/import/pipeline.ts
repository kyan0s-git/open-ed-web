import type { CourseBundle } from "@/content/schema";
import { saveCourseBundle } from "@/storage/db";
import { requestPersistence, writeCourseArchive, readCourseArchive } from "@/storage/opfs";
import { detectFormat, type ArchiveFormat } from "./detect";
import { parseOcwHugoJson } from "./ocw-hugo-json";
import { Archive } from "./zip";

export interface ImportProgress {
  step: string;
  done: number;
  total: number;
}

export class UnsupportedArchiveError extends Error {
  constructor(
    readonly format: ArchiveFormat,
    message: string,
  ) {
    super(message);
    this.name = "UnsupportedArchiveError";
  }
}

export interface ImportResult {
  bundle: CourseBundle;
  format: ArchiveFormat;
}

/**
 * Take a course archive from a file on the user's machine to a browsable course.
 *
 * The archive is written to disk once and kept: assets are read out of it on demand at
 * view time rather than unpacked, which is what keeps a 250 MB course cheap to store.
 */
export async function importCourseArchive(
  file: Blob,
  onProgress: (progress: ImportProgress) => void = () => {},
): Promise<ImportResult> {
  const report = (step: string, done = 0, total = 1) => onProgress({ step, done, total });

  report("Reading archive");
  const courseId = await hashSource(file);
  const archive = await Archive.open(file);

  try {
    const detection = detectFormat(archive);
    if (detection.format !== "ocw-hugo-json") {
      throw new UnsupportedArchiveError(detection.format, explain(detection.format));
    }

    report("Saving archive");
    await requestPersistence();
    await writeCourseArchive(courseId, file);

    const bundle = await parseOcwHugoJson(archive, detection, {
      courseId,
      sourceHash: courseId,
      onProgress: (step, done, total) => report(step, done, total),
    });

    report("Indexing");
    await saveCourseBundle(bundle);

    report("Done", 1, 1);
    return { bundle, format: detection.format };
  } finally {
    await archive.close().catch(() => {});
  }
}

/** Reopen a stored archive, for reading assets after the import. */
export async function openStoredArchive(courseId: string): Promise<Archive> {
  return Archive.open(await readCourseArchive(courseId));
}

function explain(format: ArchiveFormat): string {
  switch (format) {
    case "ocw-hugo-html":
      return "This archive has the course pages but not the course data files, which this version needs to build the course structure.";
    case "ocw-legacy-ims":
      return "This looks like a pre-2022 OCW package. Re-downloading the course from ocw.mit.edu will give you the current format.";
    default:
      return "This does not look like an MIT OpenCourseWare course archive.";
  }
}

/**
 * Identify a course by its bytes, so re-importing the same download updates the course
 * in place and keeps existing progress attached to it.
 *
 * Hashing only the ends plus the length keeps this O(1) on a large file while still
 * distinguishing courses; a zip's central directory lives at the tail, so the last
 * block alone already differs between any two courses.
 */
export async function hashSource(file: Blob): Promise<string> {
  const window = 1 << 20;
  const head = file.slice(0, window);
  const tail = file.slice(Math.max(0, file.size - window));

  const bytes = new Uint8Array(
    (await head.arrayBuffer()).byteLength + (await tail.arrayBuffer()).byteLength,
  );
  bytes.set(new Uint8Array(await head.arrayBuffer()), 0);
  bytes.set(new Uint8Array(await tail.arrayBuffer()), (await head.arrayBuffer()).byteLength);

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${hex}-${file.size.toString(36)}`;
}
