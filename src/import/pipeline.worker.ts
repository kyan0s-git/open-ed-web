/// <reference lib="webworker" />
import { importCourseArchive, UnsupportedArchiveError } from "./pipeline";
import type { ImportProgress } from "./pipeline";
import type { CourseBundle } from "@/content/schema";

/**
 * Runs an import off the main thread.
 *
 * Parsing a large course means inflating and walking thousands of entries; doing that
 * on the main thread would freeze the UI for the whole import. Workers have DOMParser
 * and OPFS, so the entire pipeline moves across unchanged.
 */

export type WorkerRequest = { kind: "import"; file: File };

export type WorkerResponse =
  | { kind: "progress"; progress: ImportProgress }
  | { kind: "done"; bundle: CourseBundle }
  | { kind: "failed"; message: string; unsupported: boolean };

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  if (event.data.kind !== "import") return;

  const post = (response: WorkerResponse) => self.postMessage(response);

  importCourseArchive(event.data.file, (progress) => post({ kind: "progress", progress }))
    .then(({ bundle }) => post({ kind: "done", bundle }))
    .catch((error: Error) =>
      post({
        kind: "failed",
        message: error.message,
        unsupported: error instanceof UnsupportedArchiveError,
      }),
    );
});
