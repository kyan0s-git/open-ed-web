/**
 * A minimal file store on IndexedDB, used where the Origin Private File System cannot
 * write files: older Safari, and the WebKit webviews the desktop app runs in on macOS
 * and Linux. Blobs stored in IndexedDB are kept on disk by the browser and can still be
 * read by random access, so a course archive works the same from here.
 *
 * Plain IndexedDB rather than Dexie: this sits under the progress file, which loads
 * before first paint, and must not pull a library into the initial payload.
 */

const DB_NAME = "open-ed-web/files";
const STORE = "files";

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function idbGet(path: string): Promise<Blob | string | undefined> {
  return run("readonly", (store) => store.get(path) as IDBRequest<Blob | string | undefined>);
}

export async function idbPut(path: string, value: Blob | string): Promise<void> {
  await run("readwrite", (store) => store.put(value, path));
}

export async function idbDelete(path: string): Promise<void> {
  await run("readwrite", (store) => store.delete(path));
}

/** Delete every path under a prefix, e.g. a course's folder. */
export async function idbDeletePrefix(prefix: string): Promise<void> {
  await run("readwrite", (store) => store.delete(IDBKeyRange.bound(prefix, `${prefix}￿`)));
}
