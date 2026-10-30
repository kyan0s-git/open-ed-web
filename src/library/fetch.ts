/**
 * Download a course archive from where it is published (for OCW, ocw.mit.edu, which
 * serves archives with open CORS and byte ranges, so this works from any device).
 *
 * The body is streamed so progress can be shown, and gathered into Blob parts rather than
 * one buffer so the browser can keep a large course on disk. A dropped connection resumes
 * from the last byte received with a Range request, as long as the file has not changed
 * in the meantime (If-Range).
 */

export interface DownloadProgress {
  done: number;
  /** Null when the server does not say. */
  total: number | null;
}

export class DownloadError extends Error {}

const PART_BYTES = 8 * 1024 * 1024;
const ATTEMPTS = 4;

export async function downloadArchive(
  url: string,
  onProgress: (progress: DownloadProgress) => void = () => {},
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  if (!/^https:\/\//i.test(url)) throw new DownloadError("Courses are only downloaded over HTTPS.");

  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let received = 0;
  let total: number | null = null;
  let validator: string | null = null;

  const flush = () => {
    if (pendingBytes === 0) return;
    parts.push(new Blob(pending as Uint8Array<ArrayBuffer>[]));
    pending = [];
    pendingBytes = 0;
  };

  for (let attempt = 1; ; attempt++) {
    try {
      const headers: Record<string, string> = {};
      if (received > 0) {
        headers.Range = `bytes=${received}-`;
        if (validator) headers["If-Range"] = validator;
      }
      const response = await fetcher(url, { headers, cache: "no-store" });

      if (received > 0 && response.status !== 206) {
        // The file changed, or the server ignores ranges: start over.
        parts.length = 0;
        pending = [];
        pendingBytes = 0;
        received = 0;
      }
      if (!response.ok) throw new DownloadError(`The course download failed: the server answered ${response.status}.`);
      if (!response.body) throw new DownloadError("The course download returned nothing.");

      if (received === 0) {
        const length = Number(response.headers.get("Content-Length"));
        total = Number.isFinite(length) && length > 0 ? length : null;
        validator = response.headers.get("ETag") ?? response.headers.get("Last-Modified");
      }

      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending.push(value);
        pendingBytes += value.byteLength;
        received += value.byteLength;
        if (pendingBytes >= PART_BYTES) flush();
        onProgress({ done: received, total });
      }
      flush();

      if (total !== null && received !== total) throw new DownloadError("The course download ended early.");
      return new Blob(parts, { type: "application/zip" });
    } catch (error) {
      flush();
      const retryable = !(error instanceof DownloadError) || /ended early/.test(error.message);
      if (!retryable || attempt >= ATTEMPTS) {
        throw error instanceof DownloadError
          ? error
          : new DownloadError("The course download was interrupted. Check your connection and try again.");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
}
