/// <reference lib="webworker" />
import type MiniSearch from "minisearch";
import { db } from "@/storage/db";
import { createIndex, runSearch, type SearchDoc, type SearchHit, type SearchOptions } from "./engine";

/**
 * Holds the search index off the main thread.
 *
 * Building it over a course with every PDF page indexed takes a couple of hundred
 * milliseconds and several megabytes; neither belongs on the thread that draws the
 * page. The index is built from IndexedDB on the first query, and rebuilt lazily after
 * the main thread says the documents changed.
 */

export type SearchRequest =
  | { type: "search"; id: number; query: string; options: SearchOptions }
  | { type: "invalidate" };

export type SearchResponse = { type: "results"; id: number; hits: SearchHit[]; documents: number };

let index: MiniSearch<SearchDoc> | null = null;
let building: Promise<MiniSearch<SearchDoc>> | null = null;
let generation = 0;

function ensureIndex(): Promise<MiniSearch<SearchDoc>> {
  if (index) return Promise.resolve(index);
  if (building) return building;

  const started = generation;
  building = db.searchDocs.toArray().then((docs) => {
    const fresh = createIndex();
    fresh.addAll(docs);
    building = null;
    // Documents changed while building: serve this one now, rebuild next time.
    if (started === generation) index = fresh;
    return fresh;
  });
  return building;
}

self.addEventListener("message", async (event: MessageEvent<SearchRequest>) => {
  const request = event.data;

  if (request.type === "invalidate") {
    generation += 1;
    index = null;
    return;
  }

  const current = await ensureIndex();
  const response: SearchResponse = {
    type: "results",
    id: request.id,
    hits: runSearch(current, request.query, request.options),
    documents: current.documentCount,
  };
  self.postMessage(response);
});
