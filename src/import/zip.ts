import {
  BlobReader,
  BlobWriter,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
  configure,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";

// zip.js reaches for web workers by default. Node (tests, scripts) has no global
// Worker, so fall back to the main thread there.
if (typeof Worker === "undefined") configure({ useWebWorkers: false });

export interface ArchiveEntry {
  /** Path with any single common root folder stripped. */
  path: string;
  sizeBytes: number;
}

/**
 * Random-access reader over a course archive.
 *
 * Nothing is inflated up front: `open` reads only the central directory, and each
 * `text`/`bytes`/`blob` call inflates exactly one entry. This is what lets a
 * 250 MB course be stored once and read on demand rather than unpacked.
 */
export class Archive {
  readonly #reader: ZipReader<unknown>;
  readonly #entries = new Map<string, FileEntry>();
  readonly #byBasename = new Map<string, FileEntry[]>();

  /** The common root folder stripped from every path, if the archive had one. */
  readonly rootPrefix: string;

  private constructor(reader: ZipReader<unknown>, entries: Entry[]) {
    this.#reader = reader;
    this.rootPrefix = commonRootPrefix(entries);

    for (const entry of entries) {
      if (entry.directory) continue;
      const path = entry.filename.slice(this.rootPrefix.length);
      if (!path) continue;
      this.#entries.set(path, entry);

      const base = path.slice(path.lastIndexOf("/") + 1);
      const bucket = this.#byBasename.get(base);
      if (bucket) bucket.push(entry);
      else this.#byBasename.set(base, [entry]);
    }
  }

  static async open(source: Blob): Promise<Archive> {
    const reader = new ZipReader(new BlobReader(source), { decodeText: decodeName });
    return new Archive(reader, await reader.getEntries());
  }

  get size(): number {
    return this.#entries.size;
  }

  entries(): ArchiveEntry[] {
    return [...this.#entries].map(([path, entry]) => ({
      path,
      sizeBytes: entry.uncompressedSize,
    }));
  }

  has(path: string): boolean {
    return this.#entries.has(path);
  }

  /** Paths whose basename matches, for resolving links that moved during export. */
  findByBasename(basename: string): string[] {
    return (this.#byBasename.get(basename) ?? []).map((e) =>
      e.filename.slice(this.rootPrefix.length),
    );
  }

  /** Every path matching a predicate — used to discover per-page data.json files. */
  find(predicate: (path: string) => boolean): string[] {
    return [...this.#entries.keys()].filter(predicate);
  }

  async text(path: string): Promise<string> {
    return this.#read(path, new TextWriter());
  }

  async json<T = unknown>(path: string): Promise<T> {
    const raw = await this.text(path);
    try {
      return JSON.parse(raw) as T;
    } catch (cause) {
      throw new Error(`${path} is not valid JSON`, { cause });
    }
  }

  async bytes(path: string): Promise<Uint8Array> {
    return this.#read(path, new Uint8ArrayWriter());
  }

  async blob(path: string, type = "application/octet-stream"): Promise<Blob> {
    return this.#read(path, new BlobWriter(type));
  }

  async close(): Promise<void> {
    await this.#reader.close();
  }

  async #read<T>(path: string, writer: { writable: WritableStream }): Promise<T> {
    const entry = this.#entries.get(path);
    if (!entry) throw new Error(`No such entry in archive: ${path}`);
    return (await entry.getData(writer as never)) as T;
  }
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Decode an entry name that is not flagged as UTF-8.
 *
 * The zip format says unflagged names are Code Page 437, but OCW archives store UTF-8
 * without setting the flag, so "schrödingers" would read as "schr├╢dingers" and stop
 * matching the paths in content_map.json. Try strict UTF-8 first: a real CP437 name is
 * almost never valid UTF-8, so it still falls through to zip.js's own decoding.
 */
function decodeName(value: Uint8Array): string | undefined {
  try {
    return strictUtf8.decode(value);
  } catch {
    return undefined;
  }
}

/**
 * Archives usually nest everything under one folder named after the course.
 * Strip it so downstream paths are stable whether or not the exporter added one.
 */
function commonRootPrefix(entries: Entry[]): string {
  let candidate: string | null = null;

  for (const entry of entries) {
    const slash = entry.filename.indexOf("/");
    // A file at top level means there is no single root folder.
    if (slash === -1) return "";
    const first = entry.filename.slice(0, slash + 1);
    if (candidate === null) candidate = first;
    else if (candidate !== first) return "";
  }

  return candidate ?? "";
}
