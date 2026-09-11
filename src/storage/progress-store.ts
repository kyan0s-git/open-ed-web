import { readFileText, writeFileAtomic } from "./opfs";
import {
  emptyProgress,
  mergeProgress,
  parseProgress,
  serializeProgress,
  type ProgressDoc,
} from "./progress";

/**
 * Keeps progress.json on disk.
 *
 * The working copy lives in memory and is flushed on a debounce, so typing a note or
 * ticking through a review never blocks on I/O. Two destinations are supported:
 *
 *  - always, a copy in the browser's private file system, so nothing is lost on reload;
 *  - optionally, a real file the user picked, so the same JSON lands in a folder they
 *    control (a synced folder, a git repo). Only Chromium browsers can do this today;
 *    elsewhere the export button is the way out.
 */

const FILE_NAME = "progress.json";
const FLUSH_DELAY_MS = 800;

type Listener = (doc: ProgressDoc) => void;

export class ProgressStore {
  #doc: ProgressDoc = emptyProgress();
  #handle: FileSystemFileHandle | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #listeners = new Set<Listener>();
  #lastError: Error | null = null;

  get doc(): ProgressDoc {
    return this.#doc;
  }

  /** The last write failure, so the UI can tell the user their work is not saving. */
  get lastError(): Error | null {
    return this.#lastError;
  }

  get boundToFile(): boolean {
    return this.#handle !== null;
  }

  async load(): Promise<ProgressDoc> {
    const raw = await readFileText(FILE_NAME);
    if (raw) {
      try {
        this.#doc = parseProgress(raw);
      } catch (error) {
        // A corrupt file must not cost the user everything; keep it and start clean.
        this.#lastError = error as Error;
        this.#doc = emptyProgress();
      }
    }
    this.#emit();
    return this.#doc;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Apply a change and schedule a save. */
  update(mutate: (draft: ProgressDoc) => ProgressDoc): void {
    this.#doc = mutate(this.#doc);
    this.#doc.updatedAt = new Date().toISOString();
    this.#emit();
    this.#scheduleFlush();
  }

  /** Merge an imported file into the current one, keeping the newer of each record. */
  async importFrom(raw: string): Promise<ProgressDoc> {
    const incoming = parseProgress(raw);
    this.#doc = mergeProgress(this.#doc, incoming);
    this.#emit();
    await this.flush();
    return this.#doc;
  }

  toJSON(): string {
    return serializeProgress(this.#doc);
  }

  #scheduleFlush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  }

  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    const contents = this.toJSON();
    try {
      await writeFileAtomic(FILE_NAME, contents);
      if (this.#handle) await writeToHandle(this.#handle, contents);
      this.#lastError = null;
    } catch (error) {
      this.#lastError = error as Error;
    }
    this.#emit();
  }

  /** Bind to a file the user picks, so saves land where they can see them. */
  async bindToFile(handle: FileSystemFileHandle): Promise<void> {
    this.#handle = handle;
    await this.flush();
  }

  unbindFile(): void {
    this.#handle = null;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#doc);
  }
}

async function writeToHandle(handle: FileSystemFileHandle, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

export const progressStore = new ProgressStore();

/** Offer the document as a download — the fallback everywhere without a file picker. */
export function downloadProgress(doc: ProgressDoc, filename = FILE_NAME): void {
  const url = URL.createObjectURL(
    new Blob([serializeProgress(doc)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function filePickerSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}
