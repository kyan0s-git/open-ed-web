import { parseHtmlDocument } from "./dom";

/**
 * Repairs for the HTML OCW publishes, applied once at import.
 *
 * Each rule fixes something found by surveying real archives (22 courses chosen at
 * random from OCW's catalogue, 2001 to 2024): it either duplicates something the reader
 * already does, or is a fault in the published page itself. Rules are conservative — when
 * a page does not clearly show the problem, it is left as published.
 *
 * Returns the repaired HTML and how many times each rule fired, so a course can say what
 * was changed.
 */

export type TidyRule =
  | "pager-links"
  | "layout-tables"
  | "empty-paragraphs"
  | "heading-levels"
  | "broken-emphasis"
  | "absolute-links"
  | "double-escaped";

export const TIDY_RULES: Record<TidyRule, string> = {
  "pager-links": "duplicate Previous/Next links removed (the reader has its own)",
  "layout-tables": "tables used only to place an image beside text turned into figures",
  "empty-paragraphs": "empty paragraphs removed",
  "heading-levels": "headings renumbered so each page's sections start at the top level",
  "broken-emphasis": "italics that ran across sentences repaired",
  "absolute-links": "links to this course on ocw.mit.edu pointed at the copy here",
  "double-escaped": "doubly escaped characters (a visible “&nbsp;”) decoded",
};

export type TidyCounts = Partial<Record<TidyRule, number>>;

export interface TidyOptions {
  /** The course's path on ocw.mit.edu, e.g. "courses/18-06sc-linear-algebra-fall-2011". */
  sitePath?: string;
}

export function tidyHtml(html: string, options: TidyOptions = {}): { html: string; counts: TidyCounts } {
  const counts: TidyCounts = {};
  if (!html.trim()) return { html, counts };
  const count = (rule: TidyRule, n = 1) => {
    if (n > 0) counts[rule] = (counts[rule] ?? 0) + n;
  };

  // Text-level repairs first: they are about the source string, not its structure.
  let source = html;
  const escaped = source.match(/&amp;(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi);
  if (escaped) {
    source = source.replace(/&amp;(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi, "&$1;");
    count("double-escaped", escaped.length);
  }

  const doc = parseHtmlDocument(source);
  const body = doc.body;
  if (!body) return { html, counts };

  count("pager-links", removePagerLinks(body));
  count("absolute-links", relativizeCourseLinks(body, options.sitePath));
  count("layout-tables", unwrapLayoutTables(doc, body));
  count("broken-emphasis", repairEmphasis(doc, body));
  count("heading-levels", normalizeHeadings(doc, body));
  count("empty-paragraphs", removeEmptyParagraphs(body));

  return { html: body.innerHTML, counts };
}

export function addCounts(total: TidyCounts, more: TidyCounts): void {
  for (const [rule, n] of Object.entries(more) as [TidyRule, number][]) total[rule] = (total[rule] ?? 0) + n;
}

/**
 * Scholar and resource courses put "« Previous | Next »" at the top and bottom of every
 * session page. The reader shows previous/next in study order already, and OCW's targets
 * are often a different order, so the two disagree.
 */
function removePagerLinks(body: HTMLElement): number {
  let removed = 0;
  for (const block of [...body.querySelectorAll("p, div")]) {
    const links = [...block.querySelectorAll("a")];
    if (links.length === 0 || links.length > 2) continue;
    if (!links.every((a) => /^(previous|next|prev)$/i.test((a.textContent ?? "").trim()))) continue;
    const rest = (block.textContent ?? "").replace(/previous|next|prev|[«»|<>‹›\s]/gi, "");
    if (rest !== "") continue;
    block.remove();
    removed++;
  }
  return removed;
}

/** Links to this same course on ocw.mit.edu become site paths, which resolve to the copy here. */
function relativizeCourseLinks(body: HTMLElement, sitePath?: string): number {
  if (!sitePath) return 0;
  const prefix = new RegExp(`^https?://ocw\\.mit\\.edu/${escapeRegExp(sitePath.replace(/^\/+|\/+$/g, ""))}(/|$)`, "i");
  let changed = 0;
  for (const anchor of body.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (!prefix.test(href)) continue;
    const path = href.replace(/^https?:\/\/ocw\.mit\.edu/i, "");
    anchor.setAttribute("href", path || "/");
    changed++;
  }
  return changed;
}

/**
 * A one- or two-row table whose rows pair an image with text is page layout, not data.
 * As a table it gets the reader's data styling (borders, a scroll box) and squeezes the
 * image into a narrow column; as figures it reads as intended and reflows on phones.
 */
function unwrapLayoutTables(doc: Document, body: HTMLElement): number {
  let unwrapped = 0;
  for (const table of [...body.querySelectorAll("table")]) {
    const rows = [...table.querySelectorAll("tr")];
    if (rows.length === 0 || rows.length > 2 || table.querySelector("th, table")) continue;
    const cellsPerRow = rows.map((row) => row.querySelectorAll("td").length);
    if (cellsPerRow.some((n) => n < 1 || n > 2)) continue;
    if (!rows.every((row) => row.querySelector("img"))) continue;

    const replacement = doc.createDocumentFragment();
    for (const row of rows) {
      const figure = doc.createElement("div");
      figure.className = "media";
      for (const cell of row.querySelectorAll("td")) {
        const part = doc.createElement("div");
        part.className = cell.querySelector("img") && (cell.textContent ?? "").trim() === "" ? "media__image" : "media__text";
        while (cell.firstChild) part.appendChild(cell.firstChild);
        figure.appendChild(part);
      }
      replacement.appendChild(figure);
    }
    table.replaceWith(replacement);
    unwrapped++;
  }
  return unwrapped;
}

/**
 * OCW's Markdown conversion sometimes pairs emphasis markers wrongly, so a span meant to
 * italicise a symbol runs on into the next sentence and ends at another symbol:
 * "<em>Ax = b. We explore how the properties of A</em>". When an italic span crosses a
 * sentence break and both of its ends are short symbol-like words, the intended italics
 * are those ends, so only they stay italic. Ordinary italic passages are left alone.
 */
function repairEmphasis(doc: Document, body: HTMLElement): number {
  let repaired = 0;
  for (const em of [...body.querySelectorAll("em, i")]) {
    if (em.children.length > 0) continue;
    const text = em.textContent ?? "";
    if (!/[.?!]\s+[A-Z][a-z]+\s/.test(text)) continue;
    const match = /^(\S{1,3})(\s[\s\S]*\s)(\S{1,2})$/.exec(text);
    if (!match) continue;
    const [, first, middle, last] = match;
    if (!/[A-Za-z]/.test(first!) || !/^[A-Za-z]$|^[A-Za-z][0-9A-Za-z]$/.test(last!)) continue;

    const fragment = doc.createDocumentFragment();
    const italic = (value: string) => {
      const node = doc.createElement(em.tagName.toLowerCase());
      node.textContent = value;
      return node;
    };
    fragment.append(italic(first!), doc.createTextNode(middle!), italic(last!));
    em.replaceWith(fragment);
    repaired++;
  }
  return repaired;
}

/**
 * The page title is the reader's only h1. Content headings are shifted so the highest
 * one is an h2: older courses start at h3 or h4, which made section headings look like
 * fine print, and a few use h1, which competed with the title.
 */
function normalizeHeadings(doc: Document, body: HTMLElement): number {
  const headings = [...body.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  if (headings.length === 0) return 0;
  const top = Math.min(...headings.map((h) => Number(h.tagName[1])));
  const shift = 2 - top;
  if (shift === 0) return 0;

  for (const heading of headings) {
    const level = Math.min(6, Math.max(2, Number(heading.tagName[1]) + shift));
    const replacement = doc.createElement(`h${level}`);
    for (const attribute of [...heading.attributes]) replacement.setAttribute(attribute.name, attribute.value);
    while (heading.firstChild) replacement.appendChild(heading.firstChild);
    heading.replaceWith(replacement);
  }
  return headings.length;
}

/** Paragraphs with nothing in them, which OCW's export leaves between blocks. */
function removeEmptyParagraphs(body: HTMLElement): number {
  let removed = 0;
  for (const p of [...body.querySelectorAll("p")]) {
    if ((p.textContent ?? "").replace(/ /g, "").trim() !== "") continue;
    if (p.querySelector("img, iframe, video, audio, svg, math, input, object")) continue;
    p.remove();
    removed++;
  }
  return removed;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
