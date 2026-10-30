// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "./zip";
import { detectFormat } from "./detect";
import { parseOcwHugoJson } from "./ocw-hugo-json";
import { looksLikeFileName } from "./titles";
import { standardSections } from "@/content/sections";
import type { CourseNode } from "@/content/schema";

/**
 * Runs the importer over a folder of real OCW downloads and checks what comes out:
 *
 *   OCW_SURVEY_DIR=/path/to/zips npx vitest run survey
 *
 * For each course it re-checks the problems the page repairs exist for, counts materials
 * still titled with a file name, and prints the standard sections. Opt-in, like the
 * single-archive test: courses are large and not ours to commit.
 */
const dir = process.env.OCW_SURVEY_DIR;

const PROBLEMS: [string, (html: string) => boolean][] = [
  ["previous/next links", (h) => /«\s*<a[^>]*>\s*Previous\s*<\/a>\s*\|\s*<a[^>]*>\s*Next/.test(h)],
  ["layout table with image", (h) => /<table(?:(?!<\/table>)[\s\S])*<img/.test(h) && !/<th/.test(h) && (h.match(/<tr/g) ?? []).length <= 2],
  ["headings starting below h2", (h) => { const l = [...h.matchAll(/<h([1-6])/g)].map((m) => Number(m[1])); return l.length > 0 && Math.min(...l) !== 2; }],
  ["empty paragraph", (h) => /<p>\s*<\/p>/.test(h)],
  ["double-escaped entity", (h) => /&amp;(nbsp|amp|#\d+);/.test(h)],
];

describe.skipIf(!dir)("survey of real OCW courses", () => {
  it("leaves none of the repaired problems, and names materials", async () => {
    const files = (await readdir(dir!)).filter((f) => f.endsWith(".zip")).sort();
    const totals = { courses: 0, pages: 0, resources: 0, fileTitles: 0, problems: {} as Record<string, number> };

    for (const file of files) {
      const archive = await Archive.open(new Blob([await readFile(join(dir!, file))]));
      const detection = detectFormat(archive);
      if (detection.format !== "ocw-hugo-json") {
        console.log(`${file}: skipped (${detection.format})`);
        continue;
      }
      const bundle = await parseOcwHugoJson(archive, detection, { courseId: file, sourceHash: file });
      await archive.close();
      totals.courses++;
      totals.pages += bundle.pages.length;
      totals.resources += bundle.resources.length;

      for (const page of bundle.pages) {
        for (const [name, test] of PROBLEMS) {
          if (test(page.html)) totals.problems[name] = (totals.problems[name] ?? 0) + 1;
        }
      }
      const fileTitles = bundle.resources.filter((r) => looksLikeFileName(r.title));
      totals.fileTitles += fileTitles.length;

      const childrenOf = new Map<string | null, CourseNode[]>();
      for (const node of bundle.nodes) childrenOf.set(node.parentUid, [...(childrenOf.get(node.parentUid) ?? []), node]);
      for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);
      const sections = standardSections({
        nodes: bundle.nodes,
        resources: new Map(bundle.resources.map((r) => [r.uid, r])),
        sequence: bundle.course.sequence,
        childrenOf,
      });
      const paired = sections.flatMap((s) => s.items).filter((i) => i.solution).length;

      console.log(
        [
          `${bundle.course.courseNumber} ${bundle.course.title} — ${bundle.resources.length} materials, ${bundle.course.retitled} renamed, ${fileTitles.length} still file-named`,
          `  repairs: ${JSON.stringify(bundle.course.tidied)}`,
          `  sections: ${sections.map((s) => `${s.def.label}${s.items.length ? ` ${s.items.length}` : ""}${s.page ? "*" : ""}`).join(", ")}; ${paired} solutions paired`,
          ...(fileTitles.length ? [`  still file-named, e.g.: ${fileTitles.slice(0, 3).map((r) => r.title).join(" | ")}`] : []),
          `  sample titles: ${bundle.resources.filter((r) => r.zipPath).slice(0, 4).map((r) => r.title).join(" | ")}`,
        ].join("\n"),
      );
    }

    console.log(JSON.stringify(totals, null, 2));
    expect(totals.problems).toEqual({});
  }, 600_000);
});
