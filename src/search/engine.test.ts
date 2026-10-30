import { describe, expect, it } from "vitest";
import { createIndex, excerpt, fold, highlight, runSearch, tokenize, type SearchDoc } from "./engine";

const doc = (over: Partial<SearchDoc>): SearchDoc => ({
  id: over.id ?? `c|${over.uid ?? "u"}|${over.page ?? 0}`,
  courseId: "c",
  courseTitle: "Quantum Physics I",
  uid: "u",
  kind: "page",
  title: "",
  text: "",
  ...over,
});

function index(docs: SearchDoc[]) {
  const ms = createIndex();
  ms.addAll(docs);
  return ms;
}

describe("fold", () => {
  it("drops accents and case so either spelling finds the other", () => {
    expect(fold("Schrödinger")).toBe("schrodinger");
    expect(fold("ÉLAN")).toBe("elan");
  });
});

describe("runSearch", () => {
  const ms = index([
    doc({ uid: "notes1", kind: "pdf", page: 3, title: "Lecture Note 1", text: "The Schrödinger equation is linear in the wavefunction." }),
    doc({ uid: "notes1", kind: "pdf", page: 4, title: "Lecture Note 1", text: "Linearity again: superposition of solutions." }),
    doc({ uid: "video1", kind: "transcript", page: 1, title: "Entanglement", text: "Today we talk about entangled photons." }),
    doc({ uid: "syllabus", kind: "page", title: "Syllabus", text: "Grading: problem sets and exams." }),
    doc({ uid: "other", courseId: "d", courseTitle: "Other", kind: "page", title: "Schrodinger in another course", text: "" }),
  ]);

  it("finds accented words typed without accents, as you type", () => {
    const hits = runSearch(ms, "schrod");
    expect(hits.map((h) => h.uid)).toContain("notes1");
  });

  it("requires every word, falling back to any word when nothing matches all", () => {
    expect(runSearch(ms, "schrodinger linear").map((h) => h.page)).toEqual([3]);
    expect(runSearch(ms, "superposition grading").length).toBe(2);
  });

  it("forgives a typo in longer words", () => {
    expect(runSearch(ms, "entanglment").map((h) => h.uid)).toContain("video1");
  });

  it("filters by course and by kind", () => {
    expect(runSearch(ms, "schrodinger", { courseId: "d" }).map((h) => h.uid)).toEqual(["other"]);
    expect(runSearch(ms, "schrodinger", { kinds: ["page"] }).every((h) => h.kind === "page")).toBe(true);
  });

  it("ignores queries too short to mean anything", () => {
    expect(runSearch(ms, "a")).toEqual([]);
    expect(runSearch(ms, "  ")).toEqual([]);
  });

  it("caps hits from one document so it cannot bury the rest", () => {
    const many = index(
      Array.from({ length: 8 }, (_, p) => doc({ uid: "big", kind: "pdf", page: p + 1, title: "Big", text: "photon" })),
    );
    expect(runSearch(many, "photon")).toHaveLength(3);
  });

  it("returns highlighted snippets as plain segments, never HTML", () => {
    const [hit] = runSearch(ms, "<b>schrodinger</b>", { courseId: "c", kinds: ["pdf"] });
    const marked = hit?.snippet.filter((s) => s.match).map((s) => s.text);
    expect(marked).toEqual(["Schrödinger"]);
  });
});

describe("tokenize", () => {
  it("splits on symbols as well as punctuation, for notation like bra-kets", () => {
    expect(tokenize("<x|ψ> E=mc² (Schrödinger)")).toEqual(["x", "ψ", "E", "mc²", "Schrödinger"]);
  });
});

describe("highlight and excerpt", () => {
  it("marks prefix matches at word starts, preserving the original text", () => {
    expect(highlight("Schrödinger's cat", ["schro"])).toEqual([
      { text: "Schrö", match: true },
      { text: "dinger's cat", match: false },
    ]);
  });

  it("does not mark matches in the middle of a word", () => {
    expect(highlight("photon", ["ton"]).some((s) => s.match)).toBe(false);
  });

  it("cuts a passage around the first match", () => {
    const text = `${"lorem ".repeat(60)}the key idea is superposition ${"ipsum ".repeat(60)}`;
    const segments = excerpt(text, ["superposition"], 40);
    expect(segments[0]).toEqual({ text: "…", match: false });
    expect(segments.at(-1)).toEqual({ text: "…", match: false });
    expect(segments.find((s) => s.match)?.text).toBe("superposition");
  });
});
