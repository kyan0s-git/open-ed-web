import { describe, expect, it } from "vitest";
import { tidyHtml } from "./tidy";
import { fromFileName, looksLikeFileName, readableTitle } from "./titles";

describe("tidyHtml", () => {
  it("removes OCW's in-page previous/next links", () => {
    const { html, counts } = tidyHtml(
      '<p>« <a href="../a/">Previous</a> | <a href="../b/">Next</a> »</p><h3>Session Overview</h3><p>Text</p>',
    );
    expect(html).not.toContain("Previous");
    expect(counts["pager-links"]).toBe(1);
  });

  it("keeps paragraphs that merely mention next or previous", () => {
    const { html } = tidyHtml('<p>See the <a href="x">next lecture</a> for more.</p>');
    expect(html).toContain("next lecture");
  });

  it("turns an image-beside-text layout table into a figure", () => {
    const { html, counts } = tidyHtml(
      '<table><tbody><tr><td><img src="a.png" alt=""></td><td><p>A major application of linear algebra…</p></td></tr></tbody></table>',
    );
    expect(html).not.toContain("<table");
    expect(html).toContain('class="media"');
    expect(html).toContain('class="media__image"');
    expect(counts["layout-tables"]).toBe(1);
  });

  it("leaves data tables alone", () => {
    const table = "<table><thead><tr><th>Lec</th><th>Topic</th></tr></thead><tbody><tr><td>1</td><td>Intro</td></tr></tbody></table>";
    expect(tidyHtml(table).html).toContain("<table");
  });

  it("repairs italics that ran across sentences, and only those", () => {
    const broken = "<p>In this unit we write systems in the matrix form <em>Ax = b. We explore how the properties of A</em> and b determine the solutions.</p>";
    const { html, counts } = tidyHtml(broken);
    expect(html).toContain("<em>Ax</em> = b. We explore how the properties of <em>A</em> and b");
    expect(counts["broken-emphasis"]).toBe(1);

    const prose = "<p><em>Atomistic modeling of fracture of a nanocrystal of copper. All simulation codes and numerical tools will be explained in detail.</em></p>";
    expect(tidyHtml(prose).html).toContain("<em>Atomistic modeling");
  });

  it("starts each page's headings at h2", () => {
    const { html, counts } = tidyHtml('<h3 id="a">Course Meeting Times</h3><p>x</p><h4>Prerequisites</h4>');
    expect(html).toBe('<h2 id="a">Course Meeting Times</h2><p>x</p><h3>Prerequisites</h3>');
    expect(counts["heading-levels"]).toBe(2);
    expect(tidyHtml("<h2>Fine</h2><h3>Already</h3>").counts["heading-levels"]).toBeUndefined();
  });

  it("points links to this course on ocw.mit.edu at the local copy", () => {
    const { html } = tidyHtml(
      '<a href="https://ocw.mit.edu/courses/18-06sc-linear-algebra-fall-2011/pages/syllabus/">Syllabus</a> <a href="https://ocw.mit.edu/courses/other-course/">Other</a>',
      { sitePath: "courses/18-06sc-linear-algebra-fall-2011" },
    );
    expect(html).toContain('href="/courses/18-06sc-linear-algebra-fall-2011/pages/syllabus/"');
    expect(html).toContain('href="https://ocw.mit.edu/courses/other-course/"');
  });

  it("decodes doubly escaped entities and drops empty paragraphs", () => {
    const { html, counts } = tidyHtml("<p>Week&amp;nbsp;8</p><p> </p><p>&nbsp;</p><p><img src=a.png></p>");
    expect(html).toContain("Week&nbsp;8");
    expect(html).not.toContain("&amp;nbsp;");
    expect(html).toContain("<img");
    expect(counts["double-escaped"]).toBe(1);
    expect(counts["empty-paragraphs"]).toBe(2);
  });
});

describe("material titles", () => {
  it("recognises file names and placeholders", () => {
    for (const name of ["ps9_solutions.pdf", "lecture11.pdf", "MIT18_06SCF11_ex1.pdf", "3play pdf file", "Unit_1_WIDE.jpg"]) {
      expect(looksLikeFileName(name), name).toBe(true);
    }
    for (const name of ["Lecture 11: Graphs", "Problem Set 9", "The Geometry of Linear Equations", "Ch. 3 notes.pdf and slides"]) {
      expect(looksLikeFileName(name), name).toBe(false);
    }
  });

  it("decodes file names", () => {
    expect(fromFileName("ps9_solutions.pdf")).toBe("Problem Set 9 Solutions");
    expect(fromFileName("lecture11.pdf")).toBe("Lecture 11");
    expect(fromFileName("MIT18_06SCF11_ex1.pdf")).toBe("Exam 1");
    expect(fromFileName("MIT8_04S16_LecNotes1.pdf")).toBe("Lecture Notes 1");
    expect(fromFileName("3play pdf file")).toBe("Transcript");
  });

  it("prefers what the course calls a file, with its page for context when needed", () => {
    expect(readableTitle("MIT18_06SCF11_Ses1.1prob.pdf", { linkText: "Problems (PDF)", pageTitle: "The Geometry of Linear Equations", pageLinkCount: 8 })).toBe(
      "The Geometry of Linear Equations: Problems",
    );
    expect(readableTitle("lecture11.pdf", { linkText: "Lecture 11: Graphs (PDF - 1.2MB)", pageTitle: "Lecture Notes", pageLinkCount: 30 })).toBe(
      "Lecture 11: Graphs",
    );
    expect(readableTitle("ps9_solutions.pdf", { linkText: "PDF", pageTitle: "Assignments", pageLinkCount: 30 })).toBe("Assignments: PDF");
    expect(readableTitle("ps9_solutions.pdf")).toBe("Problem Set 9 Solutions");
    expect(readableTitle("Lecture 3: Proofs")).toBe("Lecture 3: Proofs");
  });
});

describe("material titles from table rows", () => {
  it("names a format-only link from its row, using the column header", async () => {
    const { extractLinks } = await import("./html-text");
    const html = `<table><thead><tr><th>LEC #</th><th>TOPICS</th><th>NOTES</th></tr></thead><tbody>
      <tr><td>1</td><td>Introduction</td><td><a href="/resources/a/">(PDF - 2.4MB)</a></td></tr>
      <tr><td>2</td><td>Stress (Courtesy of A. Person. Used with permission.)</td><td><a href="/resources/b/">PDF 1</a> <a href="/resources/c/">Solutions (PDF)</a></td></tr>
    </tbody></table>`;
    const { labels } = extractLinks(html, "pages/x", (href) => href);
    expect(labels["/resources/a/"]).toBe("Lecture 1: Introduction");
    expect(labels["/resources/b/"]).toBe("Lecture 2: Stress, part 1");
    expect(labels["/resources/c/"]).toBe("Lecture 2: Stress: Solutions");
    expect(fromFileName("15-070j-classroom-1.jpg")).toBe("Classroom 1");
  });
});

describe("generic link labels on session pages", () => {
  it("does not repeat a link's own text, and lets the page name an exam", async () => {
    const { extractLinks } = await import("./html-text");
    const { labels } = extractLinks('<ul><li><a href="/r/p/">Problems (PDF)</a></li></ul>', "pages/x", (href) => href);
    expect(labels["/r/p/"]).toBe("Problems (PDF)".replace(" (PDF)", ""));
    expect(readableTitle("MIT18_06SCF11_ex1.pdf", { linkText: "Exams (PDF)", pageTitle: "Exam 1", pageLinkCount: 3 })).toBe("Exam 1");
    expect(readableTitle("x_ses1.pdf", { linkText: "Problems", pageTitle: "The Geometry of Linear Equations", pageLinkCount: 8 })).toBe(
      "The Geometry of Linear Equations: Problems",
    );
  });
});

describe("row codes", () => {
  it("reads the topic from the link's own cell and expands codes like L1", async () => {
    const { extractLinks } = await import("./html-text");
    const html = `<table><tr><th>SES #</th><th>TOPICS</th></tr>
      <tr><td>L1</td><td>Subject Outline, Fluid Concepts (<a href="/r/1/">PDF</a>)</td></tr>
      <tr><td>R3</td><td>Hydrostatics (<a href="/r/2/">PDF - 1.1 MB</a>)</td></tr></table>`;
    const { labels } = extractLinks(html, "pages/x", (href) => href);
    expect(labels["/r/1/"]).toBe("Lecture 1: Subject Outline, Fluid Concepts");
    expect(labels["/r/2/"]).toBe("Recitation 3: Hydrostatics");
  });
});
