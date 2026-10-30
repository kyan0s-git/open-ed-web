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
  /** The text of the first link to each target, which usually says what it is. */
  labels: Record<string, string>;
}

/** Every in-course link on a page, resolved from where the page lives. */
export function extractLinks(
  html: string,
  pageDir: string,
  resolve: (href: string, pageDir: string) => string | null,
): PageLinks {
  if (!html.trim()) return { targets: [], linkTextRatio: 0, proseLength: 0, labels: {} };

  const doc = parseHtmlDocument(html);
  const targets: string[] = [];
  const seen = new Set<string>();
  const labels: Record<string, string> = {};
  let linkText = 0;

  for (const anchor of doc.querySelectorAll("a[href]")) {
    linkText += (anchor.textContent ?? "").replace(/\s+/g, "").length;
    const target = resolve(anchor.getAttribute("href") ?? "", pageDir);
    if (target !== null && !seen.has(target)) {
      seen.add(target);
      targets.push(target);
      const label = linkLabel(anchor);
      if (label) labels[target] = label;
    }
  }

  const total = ((doc.body ?? doc.documentElement)?.textContent ?? "").replace(/\s+/g, "").length;
  return {
    targets,
    linkTextRatio: total === 0 ? 0 : linkText / total,
    proseLength: Math.max(0, total - linkText),
    labels,
  };
}

/** Link text that names a format or size rather than the thing: "(PDF - 2.4MB)", "XLS". */
const FORMAT_ONLY = /^\(?\s*(pdf|zip|xls|xlsx|doc|docx|ppt|pptx|txt|tex|mp3|mp4|m4a|jpg|png|gif|html|m|py|nb|r|csv|ps|tar|gz)?\s*(-\s*)?(\d+(\.\d+)?\s*(kb|mb|gb))?\s*\)?$/i;
/** Link text that only means something next to what it is beside. */
const BESIDE = /^(problems?|solutions?|answers?|answer key|notes|slides|handouts?|transcripts?|summary|questions?|data|code|files?|supplementary|examples?)$/i;
/** The first column of a table often numbers rows; its header says of what. */
const ROW_KINDS: [RegExp, string][] = [
  [/^(lec|lecture)/i, "Lecture"],
  [/^(ses|session)/i, "Session"],
  [/^week/i, "Week"],
  [/^(rec|recitation)/i, "Recitation"],
  [/^(ps|problem set|pset)/i, "Problem Set"],
  [/^(assn|assignment|hw|homework)/i, "Assignment"],
  [/^(unit)/i, "Unit"],
  [/^(lab)/i, "Lab"],
  [/^(quiz)/i, "Quiz"],
  [/^(class|day)/i, "Class"],
];

/** Row codes like "L1", "R3", "PS2" in a table's first column. */
const ROW_CODES: [RegExp, string][] = [
  [/^L(ec)?\s?\d+$/i, "Lecture"],
  [/^R(ec)?\s?\d+$/i, "Recitation"],
  [/^(PS|P)\s?\d+$/i, "Problem Set"],
  [/^HW\s?\d+$/i, "Homework"],
  [/^Q\s?\d+$/i, "Quiz"],
  [/^(S|Ses)\s?\d+$/i, "Session"],
  [/^W(k)?\s?\d+$/i, "Week"],
];

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * What a link is called, for naming the material it points to. Usually its own text;
 * when that is only a format ("PDF") or a word that needs context ("Solutions"), the row
 * or list item it sits in supplies the rest: a lecture-notes table row "1 | Introduction |
 * (PDF)" names its file "Lecture 1: Introduction".
 */
export function linkLabel(anchor: Element): string {
  const own = squash(anchor.textContent ?? "").replace(/\s*\([^)]*\b(pdf|kb|mb)\b[^)]*\)\s*$/i, "").trim();
  // A document split into parts, linked as "PDF 1", "(PDF 2 - 2.6 MB)".
  const part = /^\(?\s*(pdf|ppt|doc)\s+(\d+)\b/i.exec(own)?.[2];
  if (part) {
    const context = contextOf(anchor);
    return context ? `${context}, part ${part}` : `Part ${part}`;
  }
  const formatOnly = own === "" || FORMAT_ONLY.test(own);
  if (!formatOnly && !BESIDE.test(own)) return own;

  const context = contextOf(anchor);
  if (formatOnly) return context;
  // A list item holding nothing but this link adds nothing to it.
  if (!context || context.toLowerCase() === own.toLowerCase()) return own;
  return `${context}: ${own}`;
}

function contextOf(anchor: Element): string {
  const row = anchor.closest("tr");
  if (row) {
    // The link's own cell counts too: topics are often written right before "(PDF)".
    const cells = [...row.children].filter((cell) => cellText(cell) !== "");
    const texts = cells.map((cell) => cellText(cell));
    if (texts.length === 0) return "";
    const [first, ...rest] = texts;
    const code = ROW_CODES.find(([pattern]) => pattern.test(first!));
    if (/^\d+[a-z]?$/i.test(first!) || code) {
      const header = headerFor(row, cells[0]!);
      const kind = ROW_KINDS.find(([pattern]) => pattern.test(header))?.[1];
      const name = code ? `${code[1]} ${/\d+/.exec(first!)![0]}` : kind ? `${kind} ${first}` : first!;
      return rest.length > 0 ? `${name}: ${rest[0]}` : name;
    }
    return texts.slice(0, 2).join(": ");
  }
  const item = anchor.closest("li, p, dd, td, h2, h3, h4");
  return item ? cellText(item) : "";
}

/** A cell's text without its links' format labels, trimmed to something title-sized. */
function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  for (const link of clone.querySelectorAll("a")) {
    const text = squash(link.textContent ?? "").replace(/\s*\([^)]*\)\s*$/, "");
    if (FORMAT_ONLY.test(text) || BESIDE.test(text)) link.remove();
  }
  const text = squash(clone.textContent ?? "")
    .replace(/\(\s*\)|\(\s*(pdf|zip|xls|doc|ppt)[^)]*\)/gi, "")
    // Credit lines belong on the material, not in its name.
    .replace(/\(?\s*(courtesy of|used with permission|image courtesy|source:)[^)]*\)?\.?/gi, "")
    .replace(/[\s:;,|–—-]+$/, "")
    .trim();
  return text.length > 120 ? `${text.slice(0, 117).trim()}…` : text;
}

function headerFor(row: Element, cell: Element): string {
  const table = row.closest("table");
  const index = [...row.children].indexOf(cell);
  const header = table?.querySelector("thead tr, tr:first-child");
  if (!header || header === row) return "";
  return squash(header.children[index]?.textContent ?? "");
}
