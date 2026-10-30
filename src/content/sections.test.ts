import { describe, expect, it } from "vitest";
import { standardSections } from "./sections";
import type { CourseNode, Resource } from "./schema";

let order = 0;
const node = (uid: string, title: string, types: string[] = [], parentUid: string | null = "p", kind: CourseNode["kind"] = "resource"): CourseNode => ({
  uid,
  title,
  parentUid,
  kind,
  order: order++,
  path: `resources/${uid}`,
  learningResourceTypes: types,
});

function sections(nodes: CourseNode[]) {
  const childrenOf = new Map<string | null, CourseNode[]>();
  for (const n of nodes) childrenOf.set(n.parentUid, [...(childrenOf.get(n.parentUid) ?? []), n]);
  const resources = new Map<string, Resource>(
    nodes.filter((n) => n.kind === "resource").map((n) => [n.uid, { uid: n.uid, title: n.title, resourcetype: "Document", zipPath: `${n.uid}.pdf`, mime: "application/pdf" } as Resource]),
  );
  return standardSections({ nodes, resources, sequence: nodes.map((n) => n.uid), childrenOf });
}

describe("standard sections", () => {
  it("groups tagged materials into the same sections, in the same order", () => {
    const result = sections([
      node("syl", "Syllabus", [], null, "page"),
      node("ex1", "Exam 1", ["Exams"]),
      node("n1", "Lecture 1", ["Lecture Notes"]),
      node("ps1", "Problem Set 1", ["Problem Sets"]),
    ]);
    expect(result.map((s) => s.def.id)).toEqual(["syllabus", "lecture-notes", "assignments", "exams"]);
    expect(result[0]!.page?.uid).toBe("syl");
  });

  it("puts each solution beside what it solves, and never across kinds", () => {
    const result = sections([
      node("ps9", "Problem Set 9", ["Problem Sets"]),
      node("ps9s", "Problem Set 9 Solutions", ["Problem Set Solutions"]),
      node("geo", "The Geometry of Linear Equations: Problems", ["Problem Sets"]),
      node("geos", "The Geometry of Linear Equations: Solutions", ["Problem Set Solutions"]),
      node("q1", "Quiz 1", ["Exams"]),
      node("e1s", "Exam 1 Solutions", ["Exam Solutions"]),
    ]);
    const assignments = result.find((s) => s.def.id === "assignments")!;
    expect(assignments.items.map((i) => [i.title, i.solution?.title])).toEqual([
      ["Problem Set 9", "Problem Set 9 Solutions"],
      ["The Geometry of Linear Equations: Problems", "The Geometry of Linear Equations: Solutions"],
    ]);
    const exams = result.find((s) => s.def.id === "exams")!;
    expect(exams.items.map((i) => [i.title, i.solution?.title])).toEqual([
      ["Quiz 1", undefined],
      ["Exam 1 Solutions", undefined],
    ]);
  });

  it("falls back to a matching page's materials when nothing is tagged", () => {
    const result = sections([
      node("ln", "Lecture Notes", [], null, "page"),
      node("a", "Intro", [], "ln"),
      node("b", "Stress", [], "ln"),
    ]);
    const notes = result.find((s) => s.def.id === "lecture-notes")!;
    expect(notes.page?.uid).toBe("ln");
    expect(notes.items.map((i) => i.title)).toEqual(["Intro", "Stress"]);
  });
});
