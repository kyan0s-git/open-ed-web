import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BlobStore } from "../core";

/**
 * Course chunks as files, for the self-hosted Node server: `<dir>/<vault>/<chunk>`.
 * Keys are validated hex before they reach a store, so they are safe as paths.
 */
export class FileBlobStore implements BlobStore {
  constructor(private readonly dir: string) {}

  async put(key: string, data: Uint8Array): Promise<void> {
    const path = join(this.dir, key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, data);
    await rename(temp, path);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(this.dir, key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => rm(join(this.dir, key), { force: true })));
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    // Prefixes are always "<vault>/", one folder.
    const folder = join(this.dir, prefix);
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const files = names.filter((name) => !name.endsWith(".tmp"));
    return Promise.all(files.map(async (name) => ({ key: `${prefix}${name}`, size: (await stat(join(folder, name))).size })));
  }
}
