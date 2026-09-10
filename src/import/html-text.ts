/**
 * Text utilities over imported course HTML.
 *
 * The search index and page outline are built once at import time so the reader
 * never re-parses HTML at query time.
 */

/** Elements that imply a word break, so text either side is not run together. */
const BLOCK_LEVEL =
  "p, div, br, li, tr, td, th, h1, h2, h3, h4, h5, h6, section, article, header, footer, blockquote, pre, figcaption";

export function htmlToText(html: string): string {
  if (!html.trim()) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.querySelectorAll("script, style")) el.remove();

  // textContent runs adjacent blocks together ("IntroductionWidgets"), which would
  // index as one unsearchable token. Separate them first.
  for (const el of doc.querySelectorAll(BLOCK_LEVEL)) el.after(doc.createTextNode(" "));

  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

export interface Heading {
  level: number;
  text: string;
}

export function extractHeadings(html: string): Heading[] {
  if (!html.trim()) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");

  return [...doc.querySelectorAll("h1, h2, h3, h4")]
    .map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: (el.textContent ?? "").trim(),
    }))
    .filter((h) => h.text.length > 0);
}
