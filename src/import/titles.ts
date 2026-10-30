/**
 * Human titles for course materials.
 *
 * Most OCW resources are titled with their file name ("ps9_solutions.pdf", "lecture11.pdf",
 * "MIT18_06SCF11_ex1.pdf") or a placeholder ("3play pdf file"): 1,343 of them across 22
 * courses surveyed. Those names are what lists, search results and previous/next show.
 * The page that links to a file nearly always says what it is, so that wins; failing
 * that, the file name is decoded.
 */

/** Whether a title is a file name or placeholder rather than words for people. */
export function looksLikeFileName(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/^3play\b/i.test(t)) return true;
  if (/\.[a-z0-9]{2,4}$/i.test(t) && !/\s\S+\s/.test(t.replace(/\.[a-z0-9]{2,4}$/i, ""))) return true;
  if (/^MIT\d/i.test(t) && !/\s/.test(t)) return true;
  if (!/\s/.test(t) && /[_]/.test(t)) return true;
  return false;
}

/** Link text that only makes sense next to the page it is on. */
const GENERIC = /^(problems?|solutions?|answers?|exams?|quiz(zes)?|notes|slides|handouts?|transcripts?|readings?|pdf|here|link|download|file|video|audio|summary|lecture summary|lecture video transcript|recitation video transcript|.{0,3})$/i;

export interface TitleContext {
  /** Text of the first link to this resource, in study order. */
  linkText?: string;
  /** Title of the page that link is on. */
  pageTitle?: string;
  /** How many materials that page links to; an index page's link text stands alone. */
  pageLinkCount?: number;
}

export function readableTitle(raw: string, context: TitleContext = {}): string {
  const title = raw.trim();
  if (!looksLikeFileName(title)) return title;

  const label = cleanLinkText(context.linkText ?? "");
  if (label && !looksLikeFileName(label)) {
    const generic = GENERIC.test(label);
    const page = context.pageTitle?.trim();
    // "Exams" linked from the page "Exam 1" is simply Exam 1.
    const stem = label.toLowerCase().replace(/e?s$/, "");
    if (generic && page && stem.length >= 3 && page.toLowerCase().includes(stem)) return page;
    if (generic && page && !label.toLowerCase().includes(page.toLowerCase())) return `${page}: ${capitalize(label)}`;
    return capitalize(label);
  }

  return fromFileName(title) || title;
}

/** "Problems (PDF - 1.2MB)" → "Problems". */
export function cleanLinkText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*\((pdf|zip|ppt|pptx|doc|docx|xls|xlsx|txt|tex|mp3|mp4|jpg|png|m|py|nb)\b[^)]*\)\s*$/i, "")
    .replace(/^(read|watch|see|download|view)\s+(the\s+)?/i, "")
    .trim();
}

const WORDS: Record<string, string> = {
  ps: "Problem Set",
  pset: "Problem Set",
  psets: "Problem Sets",
  hw: "Homework",
  lec: "Lecture",
  lect: "Lecture",
  lecnotes: "Lecture Notes",
  notes: "Notes",
  ex: "Exam",
  exam: "Exam",
  mt: "Midterm",
  midterm: "Midterm",
  final: "Final",
  qz: "Quiz",
  quiz: "Quiz",
  rec: "Recitation",
  recit: "Recitation",
  sol: "Solutions",
  sols: "Solutions",
  soln: "Solutions",
  solns: "Solutions",
  solution: "Solutions",
  solutions: "Solutions",
  ans: "Answers",
  key: "Key",
  proj: "Project",
  lab: "Lab",
  hand: "Handout",
  handout: "Handout",
  slides: "Slides",
  read: "Reading",
  reading: "Reading",
  readings: "Readings",
  syllabus: "Syllabus",
  sum: "Summary",
  summary: "Summary",
  prob: "Problems",
  probs: "Problems",
  assn: "Assignment",
  assignment: "Assignment",
  ch: "Chapter",
  chap: "Chapter",
  sec: "Section",
  tr: "Transcript",
  transcript: "Transcript",
};

/** "ps9_solutions.pdf" → "Problem Set 9 Solutions"; "MIT18_06SCF11_ex1.pdf" → "Exam 1". */
export function fromFileName(name: string): string {
  let stem = name.trim().replace(/\.[a-z0-9]{2,4}$/i, "");
  if (/^3play\b/i.test(stem)) return "Transcript";
  // OCW's course prefix: MIT + course number + term code, e.g. MIT18_06SCF11_ or MIT8_04S16_.
  stem = stem.replace(/^MIT[\dA-Z]*?_[\dA-Z]*?[FSJ]\d{2}_/i, "").replace(/^MIT\d+[_\d]*[A-Z]*\d*_/i, "");
  // A leading content hash, as on files uploaded through OCW Studio.
  stem = stem.replace(/^[0-9a-f]{32}_/i, "");
  // A leading course number, as in "15-070j-classroom-1" or "1-60s06".
  stem = stem.replace(/^\d{1,3}[-_.]\d{2,4}[a-z]{0,2}\d{0,2}[-_]/i, "");

  const tokens = stem
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean);
  if (tokens.length === 0) return "";

  const words = tokens.map((token) => WORDS[token.toLowerCase()] ?? (/^\d+$/.test(token) ? String(Number(token)) : capitalize(token)));
  return words.join(" ").replace(/\s+/g, " ").trim();
}

function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}
