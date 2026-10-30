import { listCourses } from "@/storage/db";
import { PARSER_VERSION } from "@/import/version";

/**
 * Bring courses imported by an older version of the importer up to date, one at a time in
 * the background, from the archive each one already has stored. Nothing is downloaded and
 * course ids stay the same, so progress is untouched. A course that fails keeps working
 * as it was and is tried again next start.
 */
export async function upgradeStoredCourses(): Promise<void> {
  const stale = (await listCourses()).filter((course) => (course.parserVersion ?? 0) < PARSER_VERSION);
  if (stale.length === 0) return;

  const [{ runReparse }, { evictCourse }, { resetSearch }, { coursesChanged }] = await Promise.all([
    import("@/import/run-import"),
    import("@/routes/useCourse"),
    import("@/search/client"),
    import("@/storage/queries"),
  ]);
  for (const course of stale) {
    try {
      await runReparse(course.id, course.importedAt);
      evictCourse(course.id);
    } catch {
      // Left as it was; it still reads fine with the older importer's output.
    }
  }
  resetSearch();
  coursesChanged();
}
