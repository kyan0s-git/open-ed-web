import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Archive } from "./zip";
import { detectFormat } from "./detect";
import { parseOcwHugoJson } from "./ocw-hugo-json";
import type { CourseBundle } from "@/content/schema";
const fixture = (name: string) => resolve(__dirname, "../../fixtures", name);

// Generated alongside the archives by scripts/make-fixtures.mjs (run by `pretest`). Read
// at runtime rather than imported, so typechecking a fresh checkout does not need it.
type FixtureUid =
  | "captionSrt"
  | "lecture1"
  | "lecture2"
  | "lectures"
  | "notesPdf"
  | "quiz"
  | "syllabus"
  | "transcript"
  | "video1"
  | "videoDuplicate";
const uids = JSON.parse(await readFile(fixture("uids.json"), "utf8")) as Record<FixtureUid, string>;

async function open(name: string): Promise<Archive> {
  return Archive.open(new Blob([await readFile(fixture(name))]));
}

async function parse(name: string): Promise<CourseBundle> {
  const archive = await open(name);
  return parseOcwHugoJson(archive, detectFormat(archive), {
    courseId: "test-course",
    sourceHash: "hash",
    importedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("detectFormat", () => {
  it("identifies a modern archive by its JSON outputs", async () => {
    const detection = detectFormat(await open("ocw-modern.zip"));
    expect(detection.format).toBe("ocw-hugo-json");
    expect(detection.base).toBe("");
  });

  it("falls back to HTML when the JSON outputs are absent", async () => {
    expect(detectFormat(await open("ocw-html-only.zip")).format).toBe("ocw-hugo-html");
  });

  it("recognises pre-2022 packages instead of guessing", async () => {
    expect(detectFormat(await open("ocw-legacy.zip")).format).toBe("ocw-legacy-ims");
  });
});

describe("Archive", () => {
  it("strips a single wrapping folder when an archive has one", async () => {
    const archive = await open("ocw-modern.zip");
    expect(archive.rootPrefix).toBe("1-001-foundations-of-widgetry-fall-2024/");
    expect(archive.has("data.json")).toBe(true);
  });

  it("reads archives with the site at the root, as real downloads are", async () => {
    const archive = await open("ocw-modern-flat.zip");
    expect(archive.rootPrefix).toBe("");
    expect(detectFormat(archive).format).toBe("ocw-hugo-json");
  });
});

describe("parseOcwHugoJson", () => {
  let bundle: CourseBundle;
  beforeAll(async () => {
    bundle = await parse("ocw-modern.zip");
  });

  const node = (uid: string) => bundle.nodes.find((n) => n.uid === uid);
  const resource = (uid: string) => bundle.resources.find((r) => r.uid === uid);

  it("reads course metadata, flattening topic paths to their leaf", () => {
    expect(bundle.course.title).toBe("Foundations of Widgetry");
    expect(bundle.course.courseNumber).toBe("1.001");
    expect(bundle.course.year).toBe("2024");
    expect(bundle.course.topics).toEqual(["Widget Design", "Algebra"]);
    expect(bundle.course.license).toContain("by-nc-sa");
    expect(bundle.course.imagePath).toBe("static_resources/cover.jpg");
  });

  it("normalizes instructor records of differing shapes", () => {
    expect(bundle.course.instructors.map((i) => i.name)).toEqual([
      "Prof. Ada Lovelace",
      "Dr. Grace Hopper",
    ]);
  });

  it("takes order and nesting from the rendered sidebar", () => {
    const top = bundle.nodes.filter((n) => n.parentUid === null && n.kind !== "resource");
    expect(top.map((n) => n.title)).toEqual(["Syllabus", "Lecture Notes", "Self-Check"]);

    const lectures = bundle.nodes.filter((n) => n.parentUid === uids.lectures && n.kind !== "resource");
    expect(lectures.map((n) => n.title)).toEqual(["1. Introduction", "2. Widget Algebra"]);
  });

  it("stores pages at their real path, not their data.json path", () => {
    expect(node(uids.lecture1)?.path).toBe("pages/lectures/lecture-1");
    expect(node(uids.notesPdf)?.path).toBe("resources/lecture-1-notes");
  });

  it("places a parentless resource under the first page that links to it", () => {
    // Linked from both "Lecture Notes" and "1. Introduction"; the sidebar-earlier wins.
    expect(node(uids.notesPdf)?.parentUid).toBe(uids.lectures);
    expect(node(uids.video1)?.parentUid).toBe(uids.lecture1);
  });

  it("resolves files the archive moved into static_resources", () => {
    expect(resource(uids.notesPdf)?.zipPath).toBe("static_resources/0a1b_lec1.pdf");
    expect(resource(uids.notesPdf)?.mime).toBe("application/pdf");
  });

  it("keeps videos via their YouTube id and attaches their transcript and captions", () => {
    const video = resource(uids.video1);
    expect(video?.youtubeId).toBe("dQw4w9WgXcQ");
    expect(video?.zipPath).toBeNull();
    expect(video?.transcriptPath).toBe("static_resources/0e1f_dQw4w9WgXcQ.pdf");
    expect(video?.captionsPath).toBe("static_resources/0c1d_dQw4w9WgXcQ.vtt");
    expect(video?.archiveUrl).toContain("archive.org");
  });

  it("accepts sizes written as strings", () => {
    expect(resource(uids.video1)?.sizeBytes).toBe(41937317);
  });

  it("drops caption and transcript records, which belong to their video", () => {
    expect(node(uids.transcript)).toBeUndefined();
    expect(node(uids.captionSrt)).toBeUndefined();
  });

  it("keeps one copy of a video published twice", () => {
    expect(bundle.resources.filter((r) => r.youtubeId === "dQw4w9WgXcQ")).toHaveLength(1);
    expect(node(uids.videoDuplicate)).toBeUndefined();
  });

  it("indexes page text and outline for search", () => {
    const lecture = bundle.pages.find((p) => p.uid === uids.lecture2);
    expect(lecture?.text).toBe(
      "Widget Algebra Composition of widgets, and why it is associative but not commutative.",
    );
    expect(bundle.pages.find((p) => p.uid === uids.lecture1)?.headings).toEqual([
      { level: 2, text: "Introduction" },
      { level: 3, text: "Reading" },
    ]);
  });

  it("orders the course as pages followed by the materials they link", () => {
    const seq = bundle.course.sequence;
    expect(seq.indexOf(uids.lectures)).toBeLessThan(seq.indexOf(uids.notesPdf));
    expect(seq.indexOf(uids.lecture1)).toBeLessThan(seq.indexOf(uids.video1));
    expect(seq.indexOf(uids.video1)).toBeLessThan(seq.indexOf(uids.lecture2));
  });

  it("makes lectures and videos skills, not index pages", () => {
    const skills = new Map(bundle.skills.map((s) => [s.nodeUid, s.kind]));
    expect(skills.get(uids.notesPdf)).toBe("Lecture Notes");
    expect(skills.get(uids.video1)).toBe("Lecture Videos");
    expect(skills.get(uids.lecture1)).toBe("Lecture Notes");
    expect(skills.get(uids.quiz)).toBe("Practice");
    // An index of links is not something to study on its own, nor is the syllabus.
    expect(skills.has(uids.lectures)).toBe(false);
    expect(skills.has(uids.syllabus)).toBe(false);
  });

  it("lists skills in study order", () => {
    const order = bundle.skills.map((s) => s.nodeUid);
    expect(order.indexOf(uids.notesPdf)).toBeLessThan(order.indexOf(uids.lecture1));
    expect(order.indexOf(uids.lecture1)).toBeLessThan(order.indexOf(uids.video1));
  });

  it("extracts gradable questions and skips ones with no answer key", () => {
    expect(bundle.exercises).toHaveLength(1);
    const [item] = bundle.exercises;
    expect(item?.promptHtml).toContain("What is a widget?");
    expect(item?.choices.map((c) => c.correct)).toEqual([false, true]);
    expect(item?.choices[1]?.html).not.toContain("correctness-icon");
    expect(item?.choices[1]?.html).toContain("A unit of widgetry");
  });

  it("removes the quiz source, which carries the answer key", () => {
    const quizPage = bundle.pages.find((page) => page.uid === uids.quiz);
    expect(quizPage?.html).not.toContain("multiple-choice");
    expect(quizPage?.text).not.toContain("A unit of widgetry");
  });

  it("keeps math source intact for the renderer", () => {
    const html = bundle.pages.find((p) => p.uid === uids.lecture1)?.html ?? "";
    expect(html).toContain("\\(W = w_1 + w_2\\)");
    expect(html).toContain("$$\\int_0^1");
  });

  it("reports nothing for a well-formed archive", () => {
    expect(bundle.warnings).toEqual([]);
  });
});
