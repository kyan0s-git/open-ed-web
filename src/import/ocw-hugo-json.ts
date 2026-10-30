import {
  CourseBundle,
  type Course,
  type CourseNode,
  type ExerciseItem,
  type NodeKind,
  type PageContent,
  type Resource,
  type ResourceType,
  type Skill,
} from "@/content/schema";
import { basename, canonicalPath, resolveHref } from "@/content/paths";
import type { Detection } from "./detect";
import { initDom } from "./dom";
import { extractHeadings, extractLinks, htmlToText, type PageLinks } from "./html-text";
import { parseNavTree, type NavEntry } from "./nav";
import type { OcwContentMap, OcwCourseData, OcwPageData } from "./ocw-types";
import { extractQuizItems, stripQuizMarkup } from "./quiz";
import type { Archive } from "./zip";

export interface ParseOptions {
  courseId: string;
  sourceHash: string;
  importedAt?: string;
  onProgress?: (step: string, done: number, total: number) => void;
}

/**
 * Learning resource types that are something to study and come back to. Solutions,
 * exams and administrative material are deliberately absent: "how well do you know
 * the exam" is not a useful question to schedule.
 */
const STUDY_TYPES = [
  "Lecture Notes",
  "Lecture Videos",
  "Lecture Audio",
  "Readings",
  "Problem Sets",
  "Problem-solving Notes",
  "Problem-solving Videos",
  "Tutorial Videos",
  "Open Textbooks",
];

/** Pages that are about the course rather than part of it. */
const ADMIN_TITLE = /^(syllabus|calendar|instructor insights|download|related resources|course info)/i;

interface ParsedRecord {
  uid: string;
  data: OcwPageData;
  /** Canonical site path the record was published at. */
  path: string;
}

/**
 * Parse a modern (Hugo-built) OCW archive into the normalized course model.
 *
 * Three sources are combined, because no single one is complete:
 *  - the `data.json` beside every page and resource carries content and metadata;
 *  - the rendered sidebar carries the course's order and nesting, which Hugo keeps out
 *    of page params;
 *  - the links on each page say where a resource belongs, because nearly all resources
 *    are published without a parent (489 of 525 in 8.04, Spring 2016).
 */
export async function parseOcwHugoJson(
  archive: Archive,
  detection: Detection,
  options: ParseOptions,
): Promise<CourseBundle> {
  await initDom();

  const { base } = detection;
  const warnings: string[] = [];
  const report = options.onProgress ?? (() => {});

  const courseData = await archive.json<OcwCourseData>(`${base}data.json`);
  const contentMap = await readContentMap(archive, base, warnings);
  const records = await readRecords(archive, base, contentMap, warnings, report);

  report("Linking materials", 0, 1);
  dropMediaSidecars(records);

  const nav = await readNav(archive, base, warnings);
  let uidByPath = new Map([...records.values()].map((r) => [r.path, r.uid]));

  // What each page links to, resolved against where the page lives.
  const links = new Map<string, PageLinks>();
  for (const record of records.values()) {
    if (kindOf(record.data) === "resource") continue;
    links.set(record.uid, extractLinks(record.data.content ?? "", record.path, resolveHref));
  }

  dropDuplicateResources(records, links, uidByPath);
  uidByPath = new Map([...records.values()].map((r) => [r.path, r.uid]));

  const nodes = buildNodes(nav, records, links, uidByPath);
  const sequence = studySequence(nodes, links, uidByPath);

  report("Building pages", 0, 1);
  const pages: PageContent[] = [];
  const resources: Resource[] = [];
  const exercises: ExerciseItem[] = [];
  const quizPages = new Set<string>();

  for (const node of nodes) {
    const record = records.get(node.uid);
    if (!record) continue;

    if (node.kind === "resource") {
      resources.push(toResource(record, archive, base, warnings));
      continue;
    }

    const source = record.data.content ?? "";
    const questions = extractQuizItems(source, {
      skillId: skillIdFor(options.courseId, node.uid),
      pageUid: node.uid,
    });
    if (questions.length > 0) quizPages.add(node.uid);
    exercises.push(...questions);

    // The extracted questions replace the quiz source, which carries its answer key.
    const html = questions.length > 0 ? stripQuizMarkup(source) : source;
    pages.push({ uid: node.uid, html, text: htmlToText(html), headings: extractHeadings(html) });
  }

  const skills = deriveSkills(options.courseId, nodes, records, links, quizPages, sequence);

  report("Validating", 1, 1);

  return CourseBundle.parse({
    course: toCourse(courseData, archive, base, sequence, options),
    nodes,
    pages,
    resources,
    exercises,
    skills,
    warnings,
  } satisfies CourseBundle);
}

export function skillIdFor(courseId: string, uid: string): string {
  return `${courseId}:${uid}`;
}

async function readContentMap(
  archive: Archive,
  base: string,
  warnings: string[],
): Promise<OcwContentMap> {
  const path = `${base}content_map.json`;
  if (!archive.has(path)) return {};
  try {
    return await archive.json<OcwContentMap>(path);
  } catch (error) {
    warnings.push(`content_map.json unreadable: ${(error as Error).message}`);
    return {};
  }
}

async function readRecords(
  archive: Archive,
  base: string,
  contentMap: OcwContentMap,
  warnings: string[],
  report: (step: string, done: number, total: number) => void,
): Promise<Map<string, ParsedRecord>> {
  const dataPaths = archive
    .find((p) => p.startsWith(base) && p.endsWith("data.json") && p !== `${base}data.json`)
    .sort();

  const records = new Map<string, ParsedRecord>();

  for (const [index, path] of dataPaths.entries()) {
    if (index % 25 === 0) report("Reading pages", index, dataPaths.length);

    let data: OcwPageData;
    try {
      data = await archive.json<OcwPageData>(path);
    } catch (error) {
      warnings.push(`Skipped ${path}: ${(error as Error).message}`);
      continue;
    }

    if (!data.uid) {
      // Section listings (pages/, resources/) publish a data.json with no identity of
      // their own. They are navigation, not content, so skipping them is expected.
      if (data.content_type) warnings.push(`Skipped ${path}: no uid`);
      continue;
    }
    if (data.draft) continue;

    const published = contentMap[data.uid];
    const path_ = canonicalPath(published ?? path.slice(base.length));
    records.set(data.uid, { uid: data.uid, data, path: path_ });
  }

  report("Reading pages", dataPaths.length, dataPaths.length);
  return records;
}

/** Caption formats. A caption file on its own is never something to study. */
const CAPTION_FILE = /\.(srt|vtt|sbv|ttml|dfxp)$/i;
const CAPTION_MIME = /^(application\/x-subrip|text\/vtt)$/i;

/**
 * Caption and transcript files are published as resources of their own, but they only
 * make sense beside their video. Each video already points at its transcript and its
 * WebVTT captions, so those are folded into the video; courses also carry a second set
 * of captions in SubRip that no video references (8.04 ships 123 "3play caption file"
 * records). None of them belong in the course outline.
 */
function dropMediaSidecars(records: Map<string, ParsedRecord>): void {
  const referenced = new Set<string>();
  for (const { data } of records.values()) {
    const files = data.video_files;
    if (!files) continue;
    for (const file of [files.video_captions_file, files.video_transcript_file]) {
      if (file) referenced.add(basename(canonicalPath(file)));
    }
  }

  for (const [uid, { data }] of records) {
    if (!data.resourcetype || !data.file) continue;
    const name = basename(canonicalPath(data.file));
    const isCaption = CAPTION_FILE.test(name) || CAPTION_MIME.test(data.file_type ?? "");
    if (referenced.has(name) || isCaption) records.delete(uid);
  }
}

/**
 * Some courses publish the same video twice under different slugs, with the same
 * YouTube id, and link only one of them. Keep whichever copy the course actually uses.
 */
function dropDuplicateResources(
  records: Map<string, ParsedRecord>,
  links: Map<string, PageLinks>,
  uidByPath: Map<string, string>,
): void {
  const linked = new Set<string>();
  for (const pageLinks of links.values()) {
    for (const target of pageLinks.targets) {
      const uid = uidByPath.get(target);
      if (uid) linked.add(uid);
    }
  }

  const identity = (data: OcwPageData) =>
    data.video_metadata?.youtube_id?.trim() ||
    (data.file ? basename(canonicalPath(data.file)) : "");

  const kept = new Map<string, string>();
  const used = (uid: string) => linked.has(uid) || Boolean(records.get(uid)?.data.parent_uid);

  for (const record of records.values()) {
    if (kindOf(record.data) !== "resource") continue;
    const key = identity(record.data);
    if (!key) continue;

    const existing = kept.get(key);
    if (!existing) {
      kept.set(key, record.uid);
    } else if (used(record.uid) && !used(existing)) {
      records.delete(existing);
      kept.set(key, record.uid);
    } else if (!used(record.uid)) {
      records.delete(record.uid);
    }
  }
}

async function readNav(archive: Archive, base: string, warnings: string[]): Promise<NavEntry[]> {
  const path = `${base}index.html`;
  if (!archive.has(path)) {
    warnings.push("No index.html; course order falls back to page order.");
    return [];
  }

  const nav = parseNavTree(await archive.text(path));
  if (nav.length === 0) warnings.push("Course navigation was empty; order falls back to page order.");
  return nav;
}

/**
 * Merge the sidebar with every parsed record.
 *
 * The sidebar decides order and nesting for pages. A resource belongs under its declared
 * parent when it has one, and otherwise under the first page — in sidebar order — that
 * links to it, in the position that link appears. Nothing parsed is dropped.
 */
function buildNodes(
  nav: NavEntry[],
  records: Map<string, ParsedRecord>,
  links: Map<string, PageLinks>,
  uidByPath: Map<string, string>,
): CourseNode[] {
  const nodes: CourseNode[] = [];
  const placed = new Set<string>();

  const push = (record: ParsedRecord, parentUid: string | null, order: number, title?: string) => {
    placed.add(record.uid);
    nodes.push({
      uid: record.uid,
      parentUid,
      kind: kindOf(record.data),
      title: (title || record.data.title || "Untitled").trim(),
      order,
      path: record.path,
      learningResourceTypes: record.data.learning_resource_types ?? [],
    });
  };

  for (const entry of nav) {
    const record = records.get(entry.uid);
    // The sidebar can list things that were not published (drafts, external links).
    if (record) push(record, entry.parentUid, entry.order, entry.title);
  }

  // Pages missing from the sidebar keep their declared parent.
  let tail = nav.length;
  for (const record of records.values()) {
    if (placed.has(record.uid) || kindOf(record.data) === "resource") continue;
    const parent = record.data.parent_uid;
    push(record, parent && records.has(parent) ? parent : null, tail++);
  }

  // Resources go where they are linked from, in link order.
  const pageOrder = nodes.filter((n) => n.kind !== "resource").map((n) => n.uid);
  const linkedFrom = new Map<string, { parent: string; position: number }>();
  for (const pageUid of pageOrder) {
    for (const [position, target] of (links.get(pageUid)?.targets ?? []).entries()) {
      const uid = uidByPath.get(target);
      if (uid && !linkedFrom.has(uid)) linkedFrom.set(uid, { parent: pageUid, position });
    }
  }

  for (const record of records.values()) {
    if (placed.has(record.uid)) continue;
    const declared = record.data.parent_uid;
    const link = linkedFrom.get(record.uid);
    if (declared && records.has(declared)) push(record, declared, link?.position ?? tail++);
    else if (link) push(record, link.parent, link.position);
    else push(record, null, tail++);
  }

  return nodes;
}

/**
 * The order to work through the course in: each page in sidebar order, then the
 * materials it links to in the order it lists them, then its sub-pages. This is what
 * previous/next follow, and the order skills are listed in.
 */
function studySequence(
  nodes: CourseNode[],
  links: Map<string, PageLinks>,
  uidByPath: Map<string, string>,
): string[] {
  const childPages = new Map<string | null, CourseNode[]>();
  const kindByUid = new Map(nodes.map((n) => [n.uid, n.kind]));
  for (const node of nodes) {
    if (node.kind === "resource") continue;
    const siblings = childPages.get(node.parentUid) ?? [];
    siblings.push(node);
    childPages.set(node.parentUid, siblings);
  }

  const sequence: string[] = [];
  const seen = new Set<string>();
  const add = (uid: string) => {
    if (!seen.has(uid)) {
      seen.add(uid);
      sequence.push(uid);
    }
  };

  const visit = (parentUid: string | null) => {
    for (const page of (childPages.get(parentUid) ?? []).sort((a, b) => a.order - b.order)) {
      add(page.uid);
      for (const target of links.get(page.uid)?.targets ?? []) {
        const uid = uidByPath.get(target);
        if (uid && kindByUid.get(uid) === "resource") add(uid);
      }
      visit(page.uid);
    }
  };

  visit(null);
  return sequence;
}

/**
 * Decide what the mastery layer schedules.
 *
 * In most OCW courses the unit of study is a lecture's notes or a video, not a page: a
 * page like "Lecture Notes" is an index of twenty PDFs, and rating it as one thing would
 * be meaningless. So skills are, in order of preference:
 *  - every study resource (lecture notes, videos, problem sets, readings);
 *  - every page with gradable questions;
 *  - every page that is mostly prose and tagged as study material.
 * A course with none of those falls back to its prose pages, minus the administrative
 * ones, so every course gets something to review.
 */
function deriveSkills(
  courseId: string,
  nodes: CourseNode[],
  records: Map<string, ParsedRecord>,
  links: Map<string, PageLinks>,
  quizPages: Set<string>,
  sequence: string[],
): Skill[] {
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const studyType = (node: CourseNode) =>
    STUDY_TYPES.find((type) => node.learningResourceTypes.includes(type));
  const isProse = (uid: string) => {
    const pageLinks = links.get(uid);
    return Boolean(pageLinks && pageLinks.proseLength >= 40 && pageLinks.linkTextRatio < 0.5);
  };

  const chosen = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === "resource") {
      const type = studyType(node);
      if (type) chosen.set(node.uid, type);
    } else if (quizPages.has(node.uid)) {
      chosen.set(node.uid, "Practice");
    } else if (studyType(node) && isProse(node.uid)) {
      chosen.set(node.uid, studyType(node) ?? "");
    }
  }

  if (chosen.size === 0) {
    for (const node of nodes) {
      if (node.kind !== "resource" && isProse(node.uid) && !ADMIN_TITLE.test(node.title)) {
        chosen.set(node.uid, "Reading");
      }
    }
  }

  // List skills in study order; anything the sequence missed goes last.
  const ordered = [...sequence.filter((uid) => chosen.has(uid))];
  for (const uid of chosen.keys()) if (!ordered.includes(uid)) ordered.push(uid);

  return ordered.flatMap((uid, order) => {
    const node = byUid.get(uid);
    if (!node || !records.has(uid)) return [];
    return [
      {
        id: skillIdFor(courseId, uid),
        courseId,
        title: node.title,
        nodeUid: uid,
        kind: chosen.get(uid) ?? "",
        order,
      },
    ];
  });
}

function kindOf(data: OcwPageData): NodeKind {
  if (data.content_type === "resource" || data.resourcetype) return "resource";
  if (data.content_type === "video_gallery" || data.videos) return "video_gallery";
  if (data.content_type === "course-section" || data.resources) return "section";
  return "page";
}

function toResource(
  record: ParsedRecord,
  archive: Archive,
  base: string,
  warnings: string[],
): Resource {
  const { data } = record;
  const youtubeId = data.video_metadata?.youtube_id?.trim() || undefined;
  const zipPath = data.file ? resolveArchivePath(data.file, archive, base) : null;

  if (data.file && !zipPath && !youtubeId) {
    warnings.push(`File missing from archive: ${basename(canonicalPath(data.file))}`);
  }

  const files = data.video_files;
  const sidecar = (file?: string) => (file ? resolveArchivePath(file, archive, base) : null);
  const size = Number(data.file_size);

  return {
    uid: record.uid,
    title: (data.title || "Untitled").trim(),
    resourcetype: normalizeResourceType(data.resourcetype, youtubeId),
    zipPath,
    mime: data.file_type || undefined,
    sizeBytes: Number.isFinite(size) && size > 0 ? size : undefined,
    descriptionHtml: data.content ?? "",
    youtubeId,
    transcriptPath: sidecar(files?.video_transcript_file),
    captionsPath: sidecar(files?.video_captions_file),
    archiveUrl: files?.archive_url || undefined,
    language: data.language,
  };
}

function normalizeResourceType(value: string | undefined, youtubeId?: string): ResourceType {
  switch (value) {
    case "Image":
    case "Video":
    case "Document":
    case "Other":
      return value;
    default:
      return youtubeId ? "Video" : "Other";
  }
}

/**
 * Map a published file URL onto an entry in the archive.
 *
 * Archives move files: a PDF published at "/courses/<slug>/<hash>_notes.pdf" is shipped as
 * "static_resources/<hash>_notes.pdf". Try the published location, then the conventional
 * export folder, then any entry with the same filename.
 */
export function resolveArchivePath(fileUrl: string, archive: Archive, base: string): string | null {
  let raw = fileUrl;
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      return null;
    }
  }

  const path = canonicalPath(raw);
  const name = basename(path);
  if (!name) return null;

  for (const candidate of [`${base}${path}`, path, `${base}static_resources/${name}`]) {
    if (archive.has(candidate)) return candidate;
  }
  return archive.findByBasename(name)[0] ?? null;
}

function toCourse(
  data: OcwCourseData,
  archive: Archive,
  base: string,
  sequence: string[],
  options: ParseOptions,
): Course {
  return {
    id: options.courseId,
    sourceHash: options.sourceHash,
    title: data.course_title?.trim() || "Untitled course",
    courseNumber: data.primary_course_number?.trim() || undefined,
    term: data.term?.trim() || undefined,
    year: data.year ? String(data.year) : undefined,
    level: data.level ?? [],
    topics: flattenTopics(data.topics),
    instructors: normalizeInstructors(data.instructors),
    descriptionHtml: data.course_description_html ?? data.course_description ?? "",
    license: data.license,
    imagePath: data.image_src ? resolveArchivePath(data.image_src, archive, base) : null,
    sitePath: data.site_url_path,
    downloadUrl: ocwDownloadUrl(data),
    sequence,
    importedAt: options.importedAt ?? new Date().toISOString(),
  };
}

/**
 * Where OCW publishes this course's archive: https://ocw.mit.edu/<site path>/<short id>.zip.
 * OCW serves these with open CORS and byte ranges, so any device can fetch a course
 * straight from MIT; the sync library stores this URL instead of the archive.
 */
export function ocwDownloadUrl(data: Pick<OcwCourseData, "site_url_path" | "site_short_id">): string | undefined {
  const path = data.site_url_path?.trim().replace(/^\/+|\/+$/g, "");
  const shortId = data.site_short_id?.trim();
  if (!path || !shortId || !/^courses\/[\w.-]+$/.test(path) || !/^[\w.-]+$/.test(shortId)) return undefined;
  return `https://ocw.mit.edu/${path}/${shortId}.zip`;
}

/** OCW topics are hierarchy paths; the leaf is the useful label. */
function flattenTopics(topics: OcwCourseData["topics"]): string[] {
  if (!Array.isArray(topics)) return [];
  const leaves = topics.map((topic) =>
    Array.isArray(topic) ? topic.at(-1) : typeof topic === "string" ? topic : undefined,
  );
  return [...new Set(leaves.filter((t): t is string => Boolean(t)))];
}

/** Instructor records vary by archive vintage; accept the shapes seen in the wild. */
function normalizeInstructors(value: unknown): Course["instructors"] {
  if (!Array.isArray(value)) return [];

  const instructors: Course["instructors"] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      instructors.push({ name: raw });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;

    const record = raw as Record<string, unknown>;
    const str = (key: string): string | undefined =>
      typeof record[key] === "string" && (record[key] as string).trim()
        ? (record[key] as string).trim()
        : undefined;

    const composed = [str("salutation"), str("first_name"), str("last_name")]
      .filter(Boolean)
      .join(" ")
      .trim();
    const name = str("title") ?? (composed || str("name"));

    if (name) instructors.push({ name, title: str("headline") ?? str("department") });
  }
  return instructors;
}
