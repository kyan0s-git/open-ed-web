// @vitest-environment node
import { describe, expect, it } from "vitest";
import { downloadArchive } from "./fetch";

const BYTES = new Uint8Array(20_000).map((_, i) => i % 251);

/** A server that serves BYTES, honours Range, and can drop the connection once. */
function server(options: { dropAfter?: number; etag?: string; ignoreRange?: boolean } = {}) {
  const calls: (string | null)[] = [];
  let dropped = false;
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const range = headers.get("Range");
    calls.push(range);
    const start = range && !options.ignoreRange ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    const body = BYTES.slice(start);
    const drop = options.dropAfter !== undefined && !dropped;
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (drop) return;
        for (let i = 0; i < body.length; i += 4096) controller.enqueue(body.slice(i, i + 4096));
        controller.close();
      },
      // A dropped connection: some bytes arrive, then the next read fails.
      pull(controller) {
        if (!drop) return;
        if (!sent) {
          sent = true;
          controller.enqueue(body.slice(0, options.dropAfter));
        } else {
          dropped = true;
          controller.error(new TypeError("network error"));
        }
      },
    });
    return new Response(stream, {
      status: start > 0 ? 206 : 200,
      headers: { "Content-Length": String(body.length), ETag: options.etag ?? '"v1"' },
    });
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("course download", () => {
  it("streams the archive and reports progress", async () => {
    const { fetcher } = server();
    const seen: number[] = [];
    const blob = await downloadArchive("https://ocw.example/course.zip", (p) => seen.push(p.done), fetcher);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(BYTES);
    expect(seen.at(-1)).toBe(BYTES.length);
  });

  it("resumes from where a dropped connection stopped", async () => {
    const { fetcher, calls } = server({ dropAfter: 7000 });
    const blob = await downloadArchive("https://ocw.example/course.zip", () => {}, fetcher);
    expect(calls).toEqual([null, "bytes=7000-"]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(BYTES);
  });

  it("starts over when the server ignores the range", async () => {
    const { fetcher } = server({ dropAfter: 7000, ignoreRange: true });
    const blob = await downloadArchive("https://ocw.example/course.zip", () => {}, fetcher);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(BYTES);
  });

  it("refuses non-HTTPS sources and reports server errors", async () => {
    await expect(downloadArchive("http://ocw.example/c.zip")).rejects.toThrow(/HTTPS/);
    const missing = (async () => new Response("no", { status: 404 })) as typeof fetch;
    await expect(downloadArchive("https://ocw.example/c.zip", () => {}, missing)).rejects.toThrow(/404/);
  });
});
