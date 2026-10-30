/// <reference lib="webworker" />
import { importCourseArchive, reparseStoredCourse, UnsupportedArchiveError } from "./pipeline";
import type { ImportProgress } from "./pipeline";
import type { CourseBundle } from "@/content/schema";

/**
 * Runs an import off the main thread.
 *
 * Parsing a large course means inflating and walking thousands of entries; doing that
 * on the main thread would freeze the UI for the whole import. Workers have DOMParser
 * and OPFS, so the entire pipeline moves across unchanged.
 */

export type WorkerRequest =
  | { kind: "import"; file: File }
  | { kind: "reparse"; courseId: string; importedAt: string };

export type WorkerResponse =
  | { kind: "progress"; progress: ImportProgress }
  | { kind: "done"; bundle: CourseBundle }
  | { kind: "failed"; message: string; unsupported: boolean };

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const post = (response: WorkerResponse) => self.postMessage(response);
  const onProgress = (progress: ImportProgress) => post({ kind: "progress", progress });

  const work =
    request.kind === "import"
      ? importCourseArchive(request.file, onProgress).then(({ bundle }) => bundle)
      : reparseStoredCourse(request.courseId, request.importedAt, onProgress);

  work
    .then((bundle) => post({ kind: "done", bundle }))
    .catch((error: Error) =>
      post({
        kind: "failed",
        message: error.message,
        unsupported: error instanceof UnsupportedArchiveError,
      }),
    );
});
