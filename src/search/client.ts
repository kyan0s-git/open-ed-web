import { useEffect, useState } from "react";
import type { SearchHit, SearchOptions } from "./engine";
import type { SearchRequest, SearchResponse } from "./search.worker";

/** Talks to the search worker, which is started on first use. */

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (response: SearchResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<SearchResponse>) => {
    pending.get(event.data.id)?.(event.data);
    pending.delete(event.data.id);
  });
  return worker;
}

export function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ type: "search", id, query, options } satisfies SearchRequest);
  });
}

let invalidateTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Tell the worker its documents changed. Batched: while PDFs are being indexed this is
 * called after every document, and rebuilding once per second is plenty.
 */
export function invalidateSearch(): void {
  if (!worker || invalidateTimer) return;
  invalidateTimer = setTimeout(() => {
    invalidateTimer = null;
    worker?.postMessage({ type: "invalidate" } satisfies SearchRequest);
  }, 1000);
}

/** Forget the index immediately, e.g. after an import or a course is removed. */
export function resetSearch(): void {
  worker?.postMessage({ type: "invalidate" } satisfies SearchRequest);
}

export interface SearchState {
  hits: SearchHit[];
  documents: number;
  loading: boolean;
}

/** Search as the query changes, debounced, ignoring answers to stale queries. */
export function useSearch(query: string, options: SearchOptions, refreshKey = 0): SearchState {
  const [state, setState] = useState<SearchState>({ hits: [], documents: 0, loading: false });
  const { courseId, kinds, limit } = options;
  const kindsKey = kinds?.join(",") ?? "";

  useEffect(() => {
    if (query.trim().length < 2) {
      setState((previous) => ({ ...previous, hits: [], loading: false }));
      return;
    }

    let live = true;
    setState((previous) => ({ ...previous, loading: true }));
    const timer = setTimeout(() => {
      void search(query, { courseId, kinds: kindsKey ? (kindsKey.split(",") as SearchOptions["kinds"]) : undefined, limit }).then(
        (response) => live && setState({ hits: response.hits, documents: response.documents, loading: false }),
      );
    }, 120);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, courseId, kindsKey, limit, refreshKey]);

  return state;
}
