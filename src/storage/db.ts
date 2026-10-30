import Dexie, { type EntityTable } from "dexie";
import type {
  Course,
  CourseNode,
  ExerciseItem,
  PageContent,
  Resource,
  Skill,
  CourseBundle,
} from "@/content/schema";
import type { SearchDoc } from "@/search/engine";

/**
 * A derived cache of parsed course content.
 *
 * IndexedDB is a store the browser already provides — nothing to install or host. It
 * exists here only so opening a course does not mean re-parsing a 250 MB archive; it
 * holds no user data and can be rebuilt from the archive at any time. The archive
 * itself and progress.json live as files in OPFS, not here.
 */

interface StoredPage extends PageContent {
  courseId: string;
}
interface StoredNode extends CourseNode {
  courseId: string;
}
interface StoredResource extends Resource {
  courseId: string;
}
interface StoredExercise extends ExerciseItem {
  courseId: string;
}

/** One PDF whose text has been indexed (or could not be), so indexing can resume. */
export interface PdfIndexEntry {
  /** courseId|zipPath */
  key: string;
  courseId: string;
  status: "done" | "failed";
}

class ContentDb extends Dexie {
  courses!: EntityTable<Course, "id">;
  nodes!: EntityTable<StoredNode, "uid">;
  pages!: EntityTable<StoredPage, "uid">;
  resources!: EntityTable<StoredResource, "uid">;
  exercises!: EntityTable<StoredExercise, "id">;
  skills!: EntityTable<Skill, "id">;
  searchDocs!: EntityTable<SearchDoc, "id">;
  pdfIndex!: EntityTable<PdfIndexEntry, "key">;

  constructor() {
    super("open-ed-web/content");
    this.version(1).stores({
      courses: "id, title, importedAt",
      nodes: "uid, courseId, parentUid",
      pages: "uid, courseId",
      resources: "uid, courseId",
      exercises: "id, courseId, skillId",
      skills: "id, courseId, nodeUid",
    });
    // Search: documents for pages and materials, plus the text of every PDF page.
    this.version(2).stores({
      searchDocs: "id, courseId",
      pdfIndex: "key, courseId",
    });
  }
}

export const db = new ContentDb();

const ALL_TABLES = () => [
  db.courses,
  db.nodes,
  db.pages,
  db.resources,
  db.exercises,
  db.skills,
  db.searchDocs,
  db.pdfIndex,
];

/**
 * Replace a course wholesale, so re-importing never leaves stale rows behind. Its PDF
 * text is re-indexed in the background afterwards.
 */
export async function saveCourseBundle(
  bundle: CourseBundle,
  searchDocs: SearchDoc[],
): Promise<void> {
  const courseId = bundle.course.id;
  const tag = <T>(rows: T[]): (T & { courseId: string })[] =>
    rows.map((row) => ({ ...row, courseId }));

  await db.transaction("rw", ALL_TABLES(), async () => {
    await deleteCourseRows(courseId);
    await db.courses.put(bundle.course);
    await db.nodes.bulkPut(tag(bundle.nodes));
    await db.pages.bulkPut(tag(bundle.pages));
    await db.resources.bulkPut(tag(bundle.resources));
    await db.exercises.bulkPut(tag(bundle.exercises));
    await db.skills.bulkPut(bundle.skills);
    await db.searchDocs.bulkPut(searchDocs);
  });
}

async function deleteCourseRows(courseId: string): Promise<void> {
  await Promise.all([
    db.nodes.where("courseId").equals(courseId).delete(),
    db.pages.where("courseId").equals(courseId).delete(),
    db.resources.where("courseId").equals(courseId).delete(),
    db.exercises.where("courseId").equals(courseId).delete(),
    db.skills.where("courseId").equals(courseId).delete(),
    db.searchDocs.where("courseId").equals(courseId).delete(),
    db.pdfIndex.where("courseId").equals(courseId).delete(),
  ]);
}

export async function deleteCourse(courseId: string): Promise<void> {
  await db.transaction("rw", ALL_TABLES(), async () => {
    await deleteCourseRows(courseId);
    await db.courses.delete(courseId);
  });
}

export async function listCourses(): Promise<Course[]> {
  return db.courses.orderBy("importedAt").reverse().toArray();
}

export async function loadCourseOutline(
  courseId: string,
): Promise<{ course: Course; nodes: CourseNode[]; resources: Resource[] } | null> {
  const course = await db.courses.get(courseId);
  if (!course) return null;

  const [nodes, resources] = await Promise.all([
    db.nodes.where("courseId").equals(courseId).toArray(),
    db.resources.where("courseId").equals(courseId).toArray(),
  ]);

  return { course, nodes: sortNodes(nodes), resources };
}

/** Sort into sidebar order: by depth-independent order within each parent. */
export function sortNodes<T extends { parentUid: string | null; order: number }>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => a.order - b.order);
}
