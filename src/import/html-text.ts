/**
 * Text utilities over imported course HTML.
 *
 * The search index and page outline are built once at import time so the reader
 * never re-parses HTML at query time.
 */
import { parseHtmlDocument } from "./dom";

/** Elements that imply a word break, so text either side is not run together. */
const BLOCK_LEVEL =
  "p, div, br, li, tr, td, th, h1, h2, h3, h4, h5, h6, section, article, header, footer, blockquote, pre, figcaption";

export function htmlToText(html: string): string {
  if (!html.trim()) return "";
  const doc = parseHtmlDocument(html);
  for (const el of doc.querySelectorAll("script, style")) el.remove();

  // textContent runs adjacent blocks together ("IntroductionWidgets"), which would
  // index as one unsearchable token. Separate them first.
  for (const el of doc.querySelectorAll(BLOCK_LEVEL)) el.after(doc.createTextNode(" "));

  return ((doc.body ?? doc.documentElement)?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export interface Heading {
  level: number;
  text: string;
}

export function extractHeadings(html: string): Heading[] {
  if (!html.trim()) return [];
  const doc = parseHtmlDocument(html);

  return [...doc.querySelectorAll("h1, h2, h3, h4")]
    .map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: (el.textContent ?? "").trim(),
    }))
    .filter((h) => h.text.length > 0);
}

export interface PageLinks {
  /** Canonical site paths this page links to, in document order, without repeats. */
  targets: string[];
  /** Share of the page's text that is link text — near 1 for an index of links. */
  linkTextRatio: number;
  /** Characters of text that are not inside a link. */
  proseLength: number;
}

/** Every in-course link on a page, resolved from where the page lives. */
export function extractLinks(
  html: string,
  pageDir: string,
  resolve: (href: string, pageDir: string) => string | null,
): PageLinks {
  if (!html.trim()) return { targets: [], linkTextRatio: 0, proseLength: 0 };

  const doc = parseHtmlDocument(html);
  const targets: string[] = [];
  const seen = new Set<string>();
  let linkText = 0;

  for (const anchor of doc.querySelectorAll("a[href]")) {
    linkText += (anchor.textContent ?? "").replace(/\s+/g, "").length;
    const target = resolve(anchor.getAttribute("href") ?? "", pageDir);
    if (target !== null && !seen.has(target)) {
      seen.add(target);
      targets.push(target);
    }
  }

  const total = ((doc.body ?? doc.documentElement)?.textContent ?? "").replace(/\s+/g, "").length;
  return {
    targets,
    linkTextRatio: total === 0 ? 0 : linkText / total,
    proseLength: Math.max(0, total - linkText),
  };
}
