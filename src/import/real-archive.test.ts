import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Archive } from "./zip";
import { detectFormat } from "./detect";
import { parseOcwHugoJson } from "./ocw-hugo-json";

/**
 * Runs the importer over a real OCW download, when one is supplied:
 *
 *   OCW_ARCHIVE=/path/to/course.zip npx vitest run real-archive
 *
 * Course archives are tens of megabytes and are not ours to commit, so this is opt-in.
 * The synthetic fixtures cover behaviour; this checks the parser against the real thing.
 */
const path = process.env.OCW_ARCHIVE;

describe.skipIf(!path)("real OCW archive", () => {
  it("imports with every material placed and nothing unexplained", async () => {
    const archive = await Archive.open(new Blob([await readFile(path!)]));
    const detection = detectFormat(archive);
    expect(detection.format).toBe("ocw-hugo-json");

    const started = performance.now();
    const bundle = await parseOcwHugoJson(archive, detection, {
      courseId: "real",
      sourceHash: "real",
    });
    const elapsed = Math.round(performance.now() - started);

    const resources = bundle.nodes.filter((n) => n.kind === "resource");
    const orphans = resources.filter((n) => n.parentUid === null);
    const pages = bundle.nodes.filter((n) => n.kind !== "resource");

    console.log(
      JSON.stringify(
        {
          title: bundle.course.title,
          elapsedMs: elapsed,
          pages: pages.map((n) => `${n.parentUid ? "  " : ""}${n.title}`),
          resources: resources.length,
          orphanResources: orphans.length,
          orphanSample: orphans.slice(0, 5).map((n) => n.title),
          skills: bundle.skills.length,
          skillKinds: Object.fromEntries(
            [...new Set(bundle.skills.map((s) => s.kind))].map((k) => [
              k,
              bundle.skills.filter((s) => s.kind === k).length,
            ]),
          ),
          firstSkills: bundle.skills.slice(0, 6).map((s) => s.title),
          sequenceLength: bundle.course.sequence.length,
          imagePath: bundle.course.imagePath,
          videosWithTranscript: bundle.resources.filter((r) => r.transcriptPath).length,
          warnings: bundle.warnings,
        },
        null,
        2,
      ),
    );

    expect(bundle.warnings).toEqual([]);
    expect(bundle.skills.length).toBeGreaterThan(0);
    expect(bundle.course.sequence.length).toBeGreaterThan(pages.length);
  });
});
