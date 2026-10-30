import type { CourseBundle } from "@/content/schema";
import { UnsupportedArchiveError, type ImportProgress } from "./pipeline";
import type { WorkerRequest, WorkerResponse } from "./pipeline.worker";

/**
 * Run an import in a worker, falling back to the main thread where workers are not
 * available. The fallback keeps the app usable rather than failing outright; it only
 * costs responsiveness during the import.
 */
export function runImport(
  file: File,
  onProgress: (progress: ImportProgress) => void,
): Promise<CourseBundle> {
  if (typeof Worker === "undefined") {
    return import("./pipeline").then(({ importCourseArchive }) =>
      importCourseArchive(file, onProgress).then(({ bundle }) => bundle),
    );
  }
  return inWorker({ kind: "import", file }, onProgress);
}

/** Re-read a stored course with the current importer (see pipeline.reparseStoredCourse). */
export function runReparse(courseId: string, importedAt: string): Promise<CourseBundle> {
  if (typeof Worker === "undefined") {
    return import("./pipeline").then(({ reparseStoredCourse }) => reparseStoredCourse(courseId, importedAt));
  }
  return inWorker({ kind: "reparse", courseId, importedAt }, () => {});
}

function inWorker(request: WorkerRequest, onProgress: (progress: ImportProgress) => void): Promise<CourseBundle> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pipeline.worker.ts", import.meta.url), {
      type: "module",
    });

    const finish = (settle: () => void) => {
      worker.terminate();
      settle();
    };

    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      switch (response.kind) {
        case "progress":
          onProgress(response.progress);
          return;
        case "done":
          finish(() => resolve(response.bundle));
          return;
        case "failed":
          finish(() =>
            reject(
              response.unsupported
                ? new UnsupportedArchiveError("unknown", response.message)
                : new Error(response.message),
            ),
          );
      }
    });

    worker.addEventListener("error", (event) =>
      finish(() => reject(new Error(event.message || "The import worker failed to start."))),
    );

    worker.postMessage(request);
  });
}
