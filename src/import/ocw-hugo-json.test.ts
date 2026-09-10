import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Archive } from "./zip";
import { detectFormat } from "./detect";
import { parseOcwHugoJson } from "./ocw-hugo-json";
import type { CourseBundle } from "@/content/schema";
import uids from "../../fixtures/uids.json";

const fixture = (name: string) => resolve(__dirname, "../../fixtures", name);

async function open(name: string): Promise<Archive> {
  return Archive.open(new Blob([await readFile(fixture(name))]));
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
  it("strips the single wrapping folder real downloads use", async () => {
    const archive = await open("ocw-modern.zip");
    expect(archive.rootPrefix).toBe("1-001-foundations-of-widgetry-fall-2024/");
    expect(archive.has("data.json")).toBe(true);
  });
});

describe("parseOcwHugoJson", () => {
  let bundle: CourseBundle;

  beforeAll(async () => {
    const archive = await open("ocw-modern.zip");
    bundle = await parseOcwHugoJson(archive, detectFormat(archive), {
      courseId: "test-course",
      sourceHash: "hash",
      importedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("reads course metadata, flattening topic paths to their leaf", () => {
    expect(bundle.course.title).toBe("Foundations of Widgetry");
    expect(bundle.course.courseNumber).toBe("1.001");
    expect(bundle.course.year).toBe("2024");
    expect(bundle.course.topics).toEqual(["Widget Design", "Algebra"]);
    expect(bundle.course.license).toContain("by-nc-sa");
  });

  it("normalizes instructor records of differing shapes", () => {
    expect(bundle.course.instructors.map((i) => i.name)).toEqual([
      "Prof. Ada Lovelace",
      "Dr. Grace Hopper",
    ]);
  });

  it("takes order and nesting from the rendered sidebar", () => {
    const titles = bundle.nodes
      .filter((n) => n.parentUid === null && n.kind !== "resource")
      .map((n) => n.title);
    expect(titles.slice(0, 3)).toEqual(["Syllabus", "Lecture Notes", "Self-Check"]);

    const lectures = bundle.nodes.filter((n) => n.parentUid === uids.lectures);
    expect(lectures.map((n) => n.title)).toEqual(["1. Introduction", "2. Widget Algebra"]);
    expect(lectures.map((n) => n.order)).toEqual([0, 1]);
  });

  it("keeps content not listed in the sidebar, under its declared parent", () => {
    const notes = bundle.nodes.find((n) => n.uid === uids.notesPdf);
    expect(notes?.parentUid).toBe(uids.lecture1);
    expect(notes?.kind).toBe("resource");
  });

  it("resolves a resource file to a real entry in the archive", () => {
    const notes = bundle.resources.find((r) => r.uid === uids.notesPdf);
    expect(notes?.zipPath).toBe("static_resources/lec1.pdf");
    expect(notes?.mime).toBe("application/pdf");
  });

  it("keeps videos, which ship no file, via their YouTube id", () => {
    const video = bundle.resources.find((r) => r.uid === uids.video1);
    expect(video?.resourcetype).toBe("Video");
    expect(video?.youtubeId).toBe("dQw4w9WgXcQ");
    expect(video?.zipPath).toBeNull();
  });

  it("indexes page text and outline for search", () => {
    const lecture = bundle.pages.find((p) => p.uid === uids.lecture1);
    expect(lecture?.text).toBe("Introduction Widgets, broadly. Reading Chapter 1.");
    expect(lecture?.headings).toEqual([
      { level: 2, text: "Introduction" },
      { level: 3, text: "Reading" },
    ]);
  });

  it("derives one skill per content page", () => {
    const titles = bundle.skills.map((s) => s.title);
    expect(titles).toContain("1. Introduction");
    expect(titles).toContain("2. Widget Algebra");
    // Resources are not skills.
    expect(titles).not.toContain("Lecture 1 Notes");
  });

  it("extracts gradable questions and skips ones with no answer key", () => {
    expect(bundle.exercises).toHaveLength(1);
    const [item] = bundle.exercises;
    expect(item?.promptHtml).toContain("What is a widget?");
    expect(item?.choices.map((c) => c.correct)).toEqual([false, true]);
    // The answer-key icon must not travel into the rendered choice.
    expect(item?.choices[1]?.html).not.toContain("correctness-icon");
    expect(item?.choices[1]?.html).toContain("A unit of widgetry");
  });

  it("reports nothing unexpected for a well-formed archive", () => {
    expect(bundle.warnings).toEqual([]);
  });
});
