/**
 * Text helpers shared by search and the PDF viewer's highlighting. No dependencies, so
 * the viewer can use them without pulling in the search index.
 */

export interface Segment {
  text: string;
  match: boolean;
}

/**
 * Lowercase and strip accents, so "schrodinger" finds "Schrödinger" and typing without
 * a dead-key still works. Applied to indexed text and queries alike.
 */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Words are runs of letters, digits and combining marks (kept so accents fold later). */
export function tokenize(text: string): string[] {
  return text.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}

/**
 * Map positions in the folded text back to the original. Folding can change length
 * (a decomposed accent disappears), so each original character records where its
 * folded form starts.
 */
function foldWithOffsets(text: string): { folded: string; offsets: number[] } {
  let folded = "";
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const piece = fold(text[i]!);
    for (let j = 0; j < piece.length; j++) offsets.push(i);
    folded += piece;
  }
  offsets.push(text.length);
  return { folded, offsets };
}

function termPattern(terms: string[]): RegExp | null {
  const unique = [...new Set(terms.map(fold))].filter(Boolean).sort((a, b) => b.length - a.length);
  if (unique.length === 0) return null;
  const escaped = unique.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Match at the start of a word; the rest of the word may differ (prefix matches).
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})`, "gu");
}

/** Split text into plain and matched segments. */
export function highlight(text: string, terms: string[]): Segment[] {
  const pattern = termPattern(terms);
  if (!pattern || !text) return [{ text, match: false }];

  const { folded, offsets } = foldWithOffsets(text);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const found of folded.matchAll(pattern)) {
    const start = offsets[found.index!]!;
    const end = offsets[found.index! + found[0].length]!;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/** A short passage around the first match, highlighted. */
export function excerpt(text: string, terms: string[], radius = 110): Segment[] {
  if (!text) return [];
  const pattern = termPattern(terms);
  const { folded, offsets } = foldWithOffsets(text);
  const first = pattern ? folded.search(pattern) : -1;

  if (first < 0) {
    const head = text.slice(0, radius * 2);
    return [{ text: head + (text.length > head.length ? "…" : ""), match: false }];
  }

  const at = offsets[first]!;
  let start = Math.max(0, at - radius);
  let end = Math.min(text.length, at + radius);
  // Prefer whole words at the edges.
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(" ", end) > at ? text.lastIndexOf(" ", end) : end;

  const segments = highlight(text.slice(start, end), terms);
  if (start > 0) segments.unshift({ text: "…", match: false });
  if (end < text.length) segments.push({ text: "…", match: false });
  return segments;
}
