import type { CourseBundle } from "@/content/schema";
import { htmlToText } from "@/import/html-text";
import { docId, type SearchDoc } from "./engine";

/**
 * OCW fills empty resource descriptions with a stock sentence ("This resource contains
 * information regarding quantum physics: Lecture Note 1."). Indexing it would make
 * every material match the course's own subject, so it is left out.
 */
const STOCK_DESCRIPTION = /^This resource contains information regarding\b/i;


/**
 * Searchable documents for everything known at import time: the course itself, its
 * pages and its materials. PDF text is added afterwards by the background indexer.
 * Must run where HTML can be parsed (the import worker prepares a parser).
 */
export function docsFromBundle(bundle: CourseBundle): SearchDoc[] {
  const { course } = bundle;
  const byUid = new Map(bundle.nodes.map((node) => [node.uid, node]));
  const pageText = new Map(bundle.pages.map((page) => [page.uid, page.text]));
  const base = { courseId: course.id, courseTitle: course.title };
  const docs: SearchDoc[] = [];

  docs.push({
    ...base,
    id: docId(course.id, "course"),
    uid: "",
    kind: "course",
    title: course.title,
    text: [
      course.courseNumber,
      htmlToText(course.descriptionHtml),
      course.topics.join(", "),
      course.instructors.map((person) => person.name).join(", "),
    ]
      .filter(Boolean)
      .join(" · "),
    detail: course.courseNumber,
  });

  for (const node of bundle.nodes) {
    if (node.kind === "resource") continue;
    docs.push({
      ...base,
      id: docId(course.id, node.uid),
      uid: node.uid,
      kind: "page",
      title: node.title,
      text: pageText.get(node.uid) ?? "",
      parent: node.parentUid ? byUid.get(node.parentUid)?.title : undefined,
    });
  }

  for (const resource of bundle.resources) {
    const node = byUid.get(resource.uid);
    // Unplaced files (course thumbnails) are not something anyone searches for.
    if (!node?.parentUid) continue;

    const description = htmlToText(resource.descriptionHtml);
    docs.push({
      ...base,
      id: docId(course.id, resource.uid),
      uid: resource.uid,
      kind: "material",
      title: resource.title,
      text: STOCK_DESCRIPTION.test(description) ? "" : description,
      parent: byUid.get(node.parentUid)?.title,
      detail: resource.youtubeId ? "Video" : resource.mime === "application/pdf" ? "PDF" : resource.resourcetype,
    });
  }

  return docs;
}
