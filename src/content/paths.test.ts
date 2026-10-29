import { describe, expect, it } from "vitest";
import { canonicalPath, resolveHref } from "./paths";

describe("canonicalPath", () => {
  it("reduces every link style seen in real archives to one form", () => {
    expect(canonicalPath("/resources/lec1/data.json")).toBe("resources/lec1");
    expect(canonicalPath("./pages/syllabus/index.html")).toBe("pages/syllabus");
    expect(canonicalPath("/courses/8-04-quantum-physics-i-spring-2016/notes.pdf")).toBe("notes.pdf");
    expect(canonicalPath("/courses/8-04-quantum-physics-i-spring-2016/")).toBe("");
    expect(canonicalPath("pages/syllabus/")).toBe("pages/syllabus");
  });
});

describe("resolveHref", () => {
  it("resolves links relative to the page they appear on", () => {
    expect(resolveHref("../../resources/lec1/index.html", "pages/lecture-notes")).toBe(
      "resources/lec1",
    );
    expect(resolveHref("../../../resources/v1/index.html", "pages/video-lectures/part-1")).toBe(
      "resources/v1",
    );
    expect(resolveHref("./static_resources/a.pdf", "")).toBe("static_resources/a.pdf");
  });

  it("treats leading-slash links as site-relative", () => {
    expect(resolveHref("/courses/x-2016/pages/exams/", "pages/syllabus")).toBe("pages/exams");
  });

  it("returns null for links that leave the course", () => {
    expect(resolveHref("https://ocw.mit.edu", "pages/a")).toBeNull();
    expect(resolveHref("mailto:a@b.c", "pages/a")).toBeNull();
    expect(resolveHref("#top", "pages/a")).toBeNull();
  });
});
