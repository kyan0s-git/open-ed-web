import MiniSearch, { type SearchResult } from "minisearch";
import { excerpt, fold, highlight, tokenize, type Segment } from "./text";

export { excerpt, fold, highlight, tokenize, type Segment };

/**
 * Full-text search over everything imported: course pages, materials, and the text of
 * every PDF page — lecture notes, problem sets and video transcripts.
 *
 * Kept free of DOM and storage so the same code runs in the search worker and in tests.
 */

export type SearchKind = "course" | "page" | "material" | "pdf" | "transcript";

export interface SearchDoc {
  /** courseId|uid|page — unique per searchable unit. */
  id: string;
  courseId: string;
  courseTitle: string;
  /** Node to open: the page, the material, or the video a transcript belongs to. */
  uid: string;
  kind: SearchKind;
  title: string;
  text: string;
  /** PDF page number, for PDF and transcript text. */
  page?: number;
  /** Where it sits in the course, e.g. "Lecture Notes". */
  parent?: string;
  /** What it is, e.g. "Video" or "PDF". */
  detail?: string;
}

export function docId(courseId: string, uid: string, page = 0): string {
  return `${courseId}|${uid}|${page}`;
}

export interface SearchHit {
  id: string;
  courseId: string;
  courseTitle: string;
  uid: string;
  kind: SearchKind;
  title: string;
  page?: number;
  parent?: string;
  detail?: string;
  score: number;
  /** The matched words as indexed, for highlighting on the page that opens. */
  terms: string[];
  titleSegments: Segment[];
  snippet: Segment[];
}

export interface SearchOptions {
  courseId?: string;
  kinds?: SearchKind[];
  limit?: number;
}

export function createIndex(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: ["title", "text"],
    storeFields: ["courseId", "courseTitle", "uid", "kind", "title", "text", "page", "parent", "detail"],
    // Split on anything that is not part of a word. MiniSearch's default splits on
    // spaces and punctuation but not symbols, so "<x|y>" or "E=mc" would each stay one
    // unmatchable token — and course notes are full of notation like that.
    tokenize: tokenize,
    processTerm: (term) => {
      const folded = fold(term);
      // Single letters match nearly everything and would only add noise.
      return folded.length > 1 ? folded : null;
    },
  });
}

/** At most this many hits from one PDF, so one long document cannot bury the rest. */
const MAX_HITS_PER_DOCUMENT = 3;

export function runSearch(
  index: MiniSearch<SearchDoc>,
  query: string,
  { courseId, kinds, limit = 60 }: SearchOptions = {},
): SearchHit[] {
  const trimmed = query.trim();
  if (fold(trimmed).replace(/[^\p{L}\p{N}]/gu, "").length < 2) return [];

  const filter = (result: SearchResult) =>
    (!courseId || result.courseId === courseId) && (!kinds || kinds.includes(result.kind as SearchKind));

  const options = {
    filter,
    boost: { title: 3 },
    // Search as you type: the last word may be unfinished.
    prefix: (term: string) => term.length > 2,
    // Forgive a typo in longer words, where one is easy to make and still unambiguous.
    fuzzy: (term: string) => (term.length > 4 ? 0.2 : false),
  } as const;

  // Every word should match; if nothing does, fall back to any word matching.
  let results = index.search(trimmed, { ...options, combineWith: "AND" });
  if (results.length === 0) results = index.search(trimmed, { ...options, combineWith: "OR" });

  const perDocument = new Map<string, number>();
  const hits: SearchHit[] = [];

  for (const result of results) {
    const key = `${result.courseId}|${result.uid}|${result.kind}`;
    const count = perDocument.get(key) ?? 0;
    if (count >= MAX_HITS_PER_DOCUMENT) continue;
    perDocument.set(key, count + 1);

    const terms = result.terms as string[];
    hits.push({
      id: result.id as string,
      courseId: result.courseId,
      courseTitle: result.courseTitle,
      uid: result.uid,
      kind: result.kind,
      title: result.title,
      page: result.page,
      parent: result.parent,
      detail: result.detail,
      score: result.score,
      terms,
      titleSegments: highlight(result.title, terms),
      snippet: excerpt(result.text ?? "", terms),
    });
    if (hits.length >= limit) break;
  }

  return hits;
}
