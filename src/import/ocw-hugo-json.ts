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
import type { Detection } from "./detect";
import { parseNavTree, type NavEntry } from "./nav";
import type { OcwContentMap, OcwCourseData, OcwPageData } from "./ocw-types";
import { extractQuizItems } from "./quiz";
import { htmlToText, extractHeadings } from "./html-text";
import type { Archive } from "./zip";

export interface ParseOptions {
  courseId: string;
  sourceHash: string;
  importedAt?: string;
  onProgress?: (step: string, done: number, total: number) => void;
}

/**
 * Parse a modern (Hugo-built) OCW archive into the normalized course model.
 *
 * Content comes from the `data.json` emitted beside every page; structure and
 * ordering come from the rendered sidebar, because Hugo keeps menu definitions out
 * of page params. Neither source alone is enough.
 */
export async function parseOcwHugoJson(
  archive: Archive,
  detection: Detection,
  options: ParseOptions,
): Promise<CourseBundle> {
  const { base } = detection;
  const warnings: string[] = [];
  const report = options.onProgress ?? (() => {});

  const courseData = await archive.json<OcwCourseData>(`${base}data.json`);
  const contentMap = await readContentMap(archive, base, warnings);

  // Every page and resource publishes its own data.json in its output directory.
  const dataPaths = archive
    .find((p) => p.startsWith(base) && p.endsWith("data.json") && p !== `${base}data.json`)
    .sort();

  const pageData = new Map<string, { data: OcwPageData; dir: string }>();
  for (const [index, path] of dataPaths.entries()) {
    report("Reading pages", index, dataPaths.length);
    let data: OcwPageData;
    try {
      data = await archive.json<OcwPageData>(path);
    } catch (error) {
      warnings.push(`Skipped ${path}: ${(error as Error).message}`);
      continue;
    }

    const uid = data.uid;
    if (!uid) {
      warnings.push(`Skipped ${path}: no uid`);
      continue;
    }
    if (data.draft) continue;

    // Directory the entry sits in, which is also its published path.
    pageData.set(uid, { data, dir: path.slice(0, path.lastIndexOf("/") + 1) });
  }

  const nav = await readNav(archive, base, warnings);
  const nodes = buildNodes(nav, pageData, contentMap, base);

  const pages: PageContent[] = [];
  const resources: Resource[] = [];
  const exercises: ExerciseItem[] = [];
  const skills: Skill[] = [];

  for (const node of nodes) {
    const entry = pageData.get(node.uid);
    if (!entry) continue;
    const { data } = entry;

    if (node.kind === "resource") {
      resources.push(toResource(node.uid, data, archive, base, warnings));
      continue;
    }

    const html = data.content ?? "";
    pages.push({
      uid: node.uid,
      html,
      text: htmlToText(html),
      headings: extractHeadings(html),
    });

    // One skill per content page: this is the unit the mastery layer schedules.
    if (html.trim().length > 0) {
      const skillId = `${options.courseId}:${node.uid}`;
      skills.push({
        id: skillId,
        courseId: options.courseId,
        title: node.title,
        nodeUid: node.uid,
        order: skills.length,
      });
      exercises.push(...extractQuizItems(html, { skillId, pageUid: node.uid }));
    }
  }

  report("Validating", 1, 1);

  return CourseBundle.parse({
    course: toCourse(courseData, options),
    nodes,
    pages,
    resources,
    exercises,
    skills,
    warnings,
  } satisfies CourseBundle);
}

async function readContentMap(
  archive: Archive,
  base: string,
  warnings: string[],
): Promise<OcwContentMap> {
  const path = `${base}content_map.json`;
  if (!archive.has(path)) {
    warnings.push("No content_map.json; internal links resolved by path instead of uid.");
    return {};
  }
  try {
    return await archive.json<OcwContentMap>(path);
  } catch (error) {
    warnings.push(`content_map.json unreadable: ${(error as Error).message}`);
    return {};
  }
}

async function readNav(
  archive: Archive,
  base: string,
  warnings: string[],
): Promise<NavEntry[]> {
  const path = `${base}index.html`;
  if (!archive.has(path)) {
    warnings.push("No index.html; course order falls back to parent_uid and path order.");
    return [];
  }

  const nav = parseNavTree(await archive.text(path));
  if (nav.length === 0) {
    warnings.push("Course navigation was empty; ordering falls back to path order.");
  }
  return nav;
}

/**
 * Merge the nav tree with the set of parsed pages.
 *
 * Nav order wins where an entry exists. Pages absent from the nav — resources reached
 * only from within a page, for instance — are appended under their `parent_uid` so
 * nothing is silently dropped from the course.
 */
function buildNodes(
  nav: NavEntry[],
  pageData: Map<string, { data: OcwPageData; dir: string }>,
  contentMap: OcwContentMap,
  base: string,
): CourseNode[] {
  const nodes: CourseNode[] = [];
  const placed = new Set<string>();
  const navOrder = new Map(nav.map((entry, index) => [entry.uid, index]));

  const pathFor = (uid: string, fallback: string): string => {
    const mapped = contentMap[uid];
    if (mapped) return mapped.replace(/^\//, "");
    return fallback.startsWith(base) ? fallback.slice(base.length) : fallback;
  };

  for (const entry of nav) {
    const found = pageData.get(entry.uid);
    // Nav can list pages that were not published (drafts, external links).
    if (!found) continue;

    placed.add(entry.uid);
    nodes.push({
      uid: entry.uid,
      parentUid: entry.parentUid,
      kind: kindOf(found.data),
      title: entry.title || found.data.title || "Untitled",
      order: entry.order,
      path: pathFor(entry.uid, found.dir),
      learningResourceTypes: found.data.learning_resource_types ?? [],
    });
  }

  for (const [uid, found] of pageData) {
    if (placed.has(uid)) continue;
    const parentUid = found.data.parent_uid ?? null;
    nodes.push({
      uid,
      parentUid: parentUid && pageData.has(parentUid) ? parentUid : null,
      kind: kindOf(found.data),
      title: found.data.title || "Untitled",
      // Sort unlisted items after everything the nav placed.
      order: navOrder.size + nodes.length,
      path: pathFor(uid, found.dir),
      learningResourceTypes: found.data.learning_resource_types ?? [],
    });
  }

  return nodes;
}

function kindOf(data: OcwPageData): NodeKind {
  if (data.resourcetype || data.file || data.video_metadata) return "resource";
  if (data.content_type === "video_gallery" || data.videos) return "video_gallery";
  if (data.content_type === "course-section" || data.resources) return "section";
  return "page";
}

function toResource(
  uid: string,
  data: OcwPageData,
  archive: Archive,
  base: string,
  warnings: string[],
): Resource {
  const youtubeId = data.video_metadata?.youtube_id?.trim();
  const zipPath = data.file ? resolveArchivePath(data.file, archive, base) : null;

  if (data.file && !zipPath && !youtubeId) {
    warnings.push(`Resource file missing from archive: ${data.file}`);
  }

  return {
    uid,
    title: data.title || "Untitled",
    resourcetype: normalizeResourceType(data.resourcetype, youtubeId),
    zipPath,
    mime: data.file_type,
    sizeBytes: data.file_size,
    youtubeId: youtubeId || undefined,
    transcriptPath: null,
    captionsPath: null,
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
 * Map a published file URL onto an actual entry in the archive.
 *
 * Exporters rewrite asset locations (OCW's help pages describe files landing in a
 * `static_resources` folder), so try the published path first, then the conventional
 * export location, then any entry with a matching filename.
 */
export function resolveArchivePath(
  fileUrl: string,
  archive: Archive,
  base: string,
): string | null {
  let path = fileUrl.split(/[?#]/)[0] ?? "";
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      // Fall through and treat it as a plain path.
    }
  }

  path = decodeURIComponent(path).replace(/^\//, "");
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (!basename) return null;

  const candidates = [
    `${base}${path}`,
    path,
    `${base}static_resources/${basename}`,
    `static_resources/${basename}`,
  ];
  for (const candidate of candidates) {
    if (archive.has(candidate)) return candidate;
  }

  return archive.findByBasename(basename)[0] ?? null;
}

function toCourse(data: OcwCourseData, options: ParseOptions): Course {
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
    importedAt: options.importedAt ?? new Date().toISOString(),
  };
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
      typeof record[key] === "string" ? (record[key] as string).trim() : undefined;

    const composed = [str("salutation"), str("first_name"), str("last_name")]
      .filter(Boolean)
      .join(" ")
      .trim();
    const name = str("title") ?? (composed || str("name"));

    if (name) instructors.push({ name, title: str("headline") ?? str("department") });
  }
  return instructors;
}
