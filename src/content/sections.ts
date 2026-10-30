import type { CourseNode, Resource } from "./schema";

/**
 * The same sections, in the same order, for every course.
 *
 * OCW courses are organised however their instructors chose: by topic, by week, by unit,
 * by "step". Surveying random courses, the menus share a few page names (Syllabus,
 * Calendar, Readings, Assignments, Exams) but little else, so finding "the exams" means
 * learning each course's layout first. OCW does tag every material with what it is
 * ("Lecture Notes", "Problem Set Solutions", "Exams"...), so the reader builds a standard
 * index from those tags: one place to look for each kind of thing, in every course.
 * The course's own structure is still there in the sidebar.
 */

export type SectionId =
  | "syllabus"
  | "calendar"
  | "lecture-notes"
  | "videos"
  | "readings"
  | "assignments"
  | "exams"
  | "recitations"
  | "projects"
  | "more";

export interface SectionDef {
  id: SectionId;
  label: string;
  /** One line on what is in it, for the overview. */
  blurb: string;
  /** OCW learning resource types that belong here. */
  types: string[];
  /** Page titles that are this section, or whose materials are, when nothing is tagged. */
  pages: RegExp;
}

export const SECTIONS: SectionDef[] = [
  { id: "syllabus", label: "Syllabus", blurb: "Goals, prerequisites, grading", types: [], pages: /^syllabus\b/i },
  { id: "calendar", label: "Calendar", blurb: "What happens when", types: [], pages: /^(calendar|schedule)\b/i },
  { id: "lecture-notes", label: "Lecture notes", blurb: "Notes and slides", types: ["Lecture Notes"], pages: /^(lecture notes|lecture slides|notes)\b/i },
  { id: "videos", label: "Lecture videos", blurb: "Recorded lectures", types: ["Lecture Videos", "Videos", "Podcasts", "Lecture Audio"], pages: /^(lecture videos|video lectures|videos)\b/i },
  { id: "readings", label: "Readings", blurb: "What to read, and texts", types: ["Readings", "Open Textbooks", "Online Textbooks"], pages: /^readings?\b/i },
  {
    id: "assignments",
    label: "Assignments",
    blurb: "Problem sets and their solutions",
    types: ["Problem Sets", "Problem Set Solutions", "Assignments", "Assignment Solutions", "Laboratory Assignments", "Activity Assignments", "Multiple Assignment Types", "Written Assignments", "Programming Assignments", "Presentation Assignments", "Design Assignments"],
    pages: /^(assignments|problem sets|homework|labs?)\b/i,
  },
  { id: "exams", label: "Exams", blurb: "Exams, quizzes and solutions", types: ["Exams", "Exam Solutions", "Supplemental Exam Materials", "Quizzes"], pages: /^(exams|quizzes|exam review)\b/i },
  { id: "recitations", label: "Recitations", blurb: "Worked problems and recitation material", types: ["Recitations", "Problem-solving Videos", "Problem-solving Notes", "Worked Examples"], pages: /^(recitations?|problem solving|tutorials?)\b/i },
  { id: "projects", label: "Projects", blurb: "Projects and examples", types: ["Projects", "Projects with Examples", "Design Assignments"], pages: /^projects?\b/i },
  { id: "more", label: "More", blurb: "Instructor insights, tools and related resources", types: ["Instructor Insights", "Tools", "Simulations", "Demonstrations"], pages: /^(instructor insights|tools|related resources|resource index|study materials)\b/i },
];

const SOLUTION_TYPE = /solutions?$/i;
const SOLUTION_TITLE = /\b(solutions?|soln?s?|answers?|answer key|key)\b/i;

export interface SectionItem {
  node: CourseNode;
  title: string;
  /** "PDF", "Video", "Page"... for a small label. */
  format: string;
  /** For an assignment or exam, its solutions when the course has them. */
  solution?: { node: CourseNode; title: string };
}

export interface Section {
  def: SectionDef;
  /** The course's own page for this, when it has one (its Syllabus, its Calendar). */
  page?: CourseNode;
  items: SectionItem[];
}

interface Input {
  nodes: CourseNode[];
  resources: Map<string, Resource>;
  /** Study order, so every list reads in the order the course is taken. */
  sequence: string[];
  childrenOf: Map<string | null, CourseNode[]>;
}

/** The standard sections a course has something for, in standard order. */
export function standardSections({ nodes, resources, sequence, childrenOf }: Input): Section[] {
  const position = new Map(sequence.map((uid, index) => [uid, index]));
  const order = (node: CourseNode) => position.get(node.uid) ?? Number.MAX_SAFE_INTEGER;
  const topPages = (childrenOf.get(null) ?? []).filter((node) => node.kind !== "resource");

  const claimed = new Set<string>();
  const sections: Section[] = [];

  for (const def of SECTIONS) {
    const page = topPages.find((node) => def.pages.test(node.title.trim()));

    // Tagged materials first: OCW's own classification.
    let members = nodes.filter(
      (node) =>
        node.kind === "resource" &&
        !claimed.has(node.uid) &&
        node.learningResourceTypes.some((type) => def.types.includes(type)),
    );

    // Courses with little tagging: whatever sits under the matching page.
    if (members.length === 0 && page && def.id !== "syllabus" && def.id !== "calendar") {
      members = descendants(page.uid, childrenOf).filter((node) => node.kind === "resource" && !claimed.has(node.uid));
    }
    // Editable source files duplicate the PDFs beside them.
    members = members.filter(
      (node) => !(node.learningResourceTypes.length > 0 && node.learningResourceTypes.every((type) => type === "Editable Files")),
    );
    for (const node of members) claimed.add(node.uid);

    const items = pairSolutions(
      members.sort((a, b) => order(a) - order(b)).map((node) => toItem(node, resources.get(node.uid))),
      def.id === "assignments" || def.id === "exams",
    );

    if (items.length > 0 || page) sections.push({ def, page, items });
  }
  return sections;
}

function descendants(uid: string, childrenOf: Map<string | null, CourseNode[]>): CourseNode[] {
  const out: CourseNode[] = [];
  for (const child of childrenOf.get(uid) ?? []) out.push(child, ...descendants(child.uid, childrenOf));
  return out;
}

function toItem(node: CourseNode, resource?: Resource): SectionItem {
  return { node, title: resource?.title ?? node.title, format: formatOf(resource) };
}

function formatOf(resource?: Resource): string {
  if (!resource) return "Page";
  if (resource.youtubeId || resource.resourcetype === "Video") return "Video";
  const path = resource.zipPath ?? "";
  const extension = /\.([a-z0-9]{2,4})$/i.exec(path)?.[1]?.toUpperCase();
  if (resource.mime === "application/pdf" || extension === "PDF") return "PDF";
  if (resource.resourcetype === "Image") return "Image";
  return extension ?? resource.resourcetype ?? "File";
}

/**
 * Put each solution beside the assignment or exam it solves, matching on the title with
 * the solution words taken out ("Problem Set 9 Solutions" → "problem set 9"), then on
 * the number alone. Solutions with no match stay in the list as their own entries.
 */
function pairSolutions(items: SectionItem[], pair: boolean): SectionItem[] {
  if (!pair) return items;
  const isSolution = (item: SectionItem) =>
    item.node.learningResourceTypes.some((type) => SOLUTION_TYPE.test(type)) || SOLUTION_TITLE.test(item.title);
  const problems = items.filter((item) => !isSolution(item));
  const solutions = items.filter(isSolution);
  if (problems.length === 0) return items;

  const key = (title: string) =>
    title
      .toLowerCase()
      .replace(new RegExp(SOLUTION_TITLE.source, "gi"), " ")
      .replace(/\b(problems?|questions?|and|with|for|the|to)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const number = (title: string) => /(\d+)(?!.*\d)/.exec(title)?.[1];
  // "Quiz 1 Solutions" must not land on "Exam 1": a number alone matches only when the
  // first word agrees too ("Problem Set 9" / "Problem set 9 answers") or says nothing.
  const sameKind = (a: string, b: string) => {
    const first = (text: string) => key(text).split(" ")[0] ?? "";
    return first(a) === first(b) || /^\d*$/.test(first(b));
  };

  const leftover: SectionItem[] = [];
  for (const solution of solutions) {
    const match =
      problems.find((p) => !p.solution && key(p.title) === key(solution.title)) ??
      problems.find(
        (p) => !p.solution && number(p.title) !== undefined && number(p.title) === number(solution.title) && sameKind(p.title, solution.title),
      );
    if (match) match.solution = { node: solution.node, title: solution.title };
    else leftover.push(solution);
  }
  return [...problems, ...leftover];
}
