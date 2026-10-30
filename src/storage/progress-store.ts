import { readFileText, renameFile, writeFileAtomic } from "./opfs";
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
        // Starting clean would overwrite the unreadable file on the next save and
        // destroy whatever it held. Set it aside under a dated name first, so the
        // user still has it and can be told where it went.
        const kept = `progress.unreadable-${Date.now()}.json`;
        await renameFile(FILE_NAME, kept).catch(() => {});
        this.#lastError = new Error(
          `${(error as Error).message} The previous file was kept as ${kept}.`,
        );
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

  /**
   * Apply a change and save it.
   *
   * Incidental updates are debounced, but anything the learner would be upset to lose —
   * a finished review, a page marked done — passes `immediate` and is written at once.
   * A debounce is the wrong place for state that took effort to produce.
   */
  update(
    mutate: (draft: ProgressDoc) => ProgressDoc,
    options: { immediate?: boolean } = {},
  ): Promise<void> {
    this.#doc = mutate(this.#doc);
    this.#doc.updatedAt = new Date().toISOString();
    this.#emit();

    if (!options.immediate) {
      this.#scheduleFlush();
      return Promise.resolve();
    }

    // Returned so callers can wait for the write to land before telling the learner
    // their work is saved.
    return this.flush();
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

  /**
   * Save no later than FLUSH_DELAY_MS after the first unsaved change. Restarting the
   * wait on every change would let steady browsing postpone the save indefinitely, and
   * then a reload or closed tab would drop all of it.
   */
  #scheduleFlush(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  }

  /**
   * Writes are serialized through this chain. Several saves can be in flight at once —
   * finishing a review writes the skill, the attempt and the page status together — and
   * letting them interleave on disk corrupts the file.
   */
  #writing: Promise<void> = Promise.resolve();

  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    this.#writing = this.#writing.then(() => this.#write());
    return this.#writing;
  }

  async #write(): Promise<void> {
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

/**
 * A debounced save is lost if the page goes away before it fires — closing the tab
 * moments after answering a review would silently discard it. Flush whenever the page
 * is hidden, which covers reloads, navigation and tab close.
 */
if (typeof document !== "undefined") {
  const flushNow = () => void progressStore.flush();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
  window.addEventListener("pagehide", flushNow);
}

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
