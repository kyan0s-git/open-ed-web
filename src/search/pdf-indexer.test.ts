import { describe, expect, it } from "vitest";
import { joinText } from "./pdf-indexer";

describe("joinText", () => {
  it("rejoins words hyphenated across a line break", () => {
    expect(joinText([{ str: "the description of our phys-", hasEOL: true }, { str: "ical universe" }])).toBe(
      "the description of our physical universe",
    );
  });

  it("keeps real hyphens that are not at a line end", () => {
    expect(joinText([{ str: "one-dimensional", hasEOL: true }, { str: "potentials" }])).toBe(
      "one-dimensional potentials",
    );
  });

  it("separates runs without doubling spaces, and skips non-text items", () => {
    expect(joinText([{ str: "Quantum" }, { str: " " }, { str: "physics" }, { type: "beginMarkedContent" }, { str: "I" }])).toBe(
      "Quantum physics I",
    );
  });
});
