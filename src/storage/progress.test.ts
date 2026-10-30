import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS_PER_COURSE,
  PROGRESS_SCHEMA,
  ProgressFormatError,
  emptyProgress,
  mergeProgress,
  parseProgress,
  serializeProgress,
  type CourseProgress,
  type ProgressDoc,
} from "./progress";

const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;

function doc(course: Partial<CourseProgress> & { updatedAt: string }): ProgressDoc {
  return {
    schema: PROGRESS_SCHEMA,
    updatedAt: course.updatedAt,
    activity: {},
    library: {},
    courses: {
      algebra: {
        title: "Algebra",
        items: {},
        skills: {},
        attempts: [],
        notes: {},
        ...course,
      },
    },
  };
}

describe("progress file", () => {
  it("round-trips through serialize and parse", () => {
    const original = emptyProgress(new Date(at(1)));
    expect(parseProgress(serializeProgress(original))).toEqual(original);
  });

  it("rejects a file from a different tool rather than silently accepting it", () => {
    expect(() => parseProgress(JSON.stringify({ schema: "anki/2", courses: {} }))).toThrow(
      ProgressFormatError,
    );
    expect(() => parseProgress("not json")).toThrow(ProgressFormatError);
  });
});

describe("activity", () => {
  it("is optional, so progress files written before it existed still load", () => {
    const legacy = JSON.stringify({ schema: PROGRESS_SCHEMA, updatedAt: at(1), courses: {} });
    expect(parseProgress(legacy).activity).toEqual({});
  });

  it("merges per day without double counting", () => {
    const a = { ...emptyProgress(new Date(at(1))), activity: { "2026-01-02": { reviews: 3, completed: 1 } } };
    const b = { ...emptyProgress(new Date(at(2))), activity: { "2026-01-02": { reviews: 2, completed: 4 }, "2026-01-03": { reviews: 1, completed: 0 } } };
    expect(mergeProgress(a, b).activity).toEqual({
      "2026-01-02": { reviews: 3, completed: 4 },
      "2026-01-03": { reviews: 1, completed: 0 },
    });
  });
});

describe("mergeProgress", () => {
  it("keeps a course only one side has", () => {
    const base = emptyProgress(new Date(at(1)));
    const merged = mergeProgress(base, doc({ updatedAt: at(2) }));
    expect(Object.keys(merged.courses)).toEqual(["algebra"]);
  });

  it("takes the newer record per item, not per file", () => {
    const base = doc({
      updatedAt: at(5),
      items: {
        lecture1: { status: "done", secondsSpent: 600, updatedAt: at(5) },
        lecture2: { status: "unseen", secondsSpent: 0, updatedAt: at(1) },
      },
    });
    const incoming = doc({
      updatedAt: at(3),
      items: {
        lecture2: { status: "in_progress", secondsSpent: 120, updatedAt: at(3) },
      },
    });

    const merged = mergeProgress(base, incoming).courses.algebra!;
    // Work done only on this device survives an older import...
    expect(merged.items.lecture1?.status).toBe("done");
    // ...and a newer record from the other device is taken.
    expect(merged.items.lecture2?.status).toBe("in_progress");
  });

  it("never loses local work to an older imported file", () => {
    const local = doc({
      updatedAt: at(9),
      skills: { s1: { level: 4, due: at(20), reps: 8, lapses: 0, fsrs: null, updatedAt: at(9) } },
    });
    const stale = doc({
      updatedAt: at(2),
      skills: { s1: { level: 1, due: at(3), reps: 1, lapses: 0, fsrs: null, updatedAt: at(2) } },
    });

    expect(mergeProgress(local, stale).courses.algebra!.skills.s1?.level).toBe(4);
  });

  it("unions attempts and de-duplicates re-imports", () => {
    const attempt = { exerciseId: "e1", at: at(4), correct: true };
    const base = doc({ updatedAt: at(4), attempts: [attempt] });
    const incoming = doc({
      updatedAt: at(6),
      attempts: [attempt, { exerciseId: "e2", at: at(6), correct: false }],
    });

    const merged = mergeProgress(base, incoming).courses.algebra!;
    expect(merged.attempts).toHaveLength(2);
    expect(mergeProgress(merged3(merged), incoming).courses.algebra!.attempts).toHaveLength(2);
  });

  it("caps the attempt log so the file cannot grow without bound", () => {
    const many = Array.from({ length: MAX_ATTEMPTS_PER_COURSE + 50 }, (_, i) => ({
      exerciseId: `e${i}`,
      at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
      correct: true,
    }));

    const merged = mergeProgress(emptyProgress(new Date(at(1))), doc({ updatedAt: at(9), attempts: many }));
    const kept = merged.courses.algebra!.attempts;
    expect(kept).toHaveLength(MAX_ATTEMPTS_PER_COURSE);
    // The oldest are the ones dropped.
    expect(kept.at(-1)?.exerciseId).toBe(`e${many.length - 1}`);
  });
});

/** Re-wrap a merged course so it can be fed back in, to check merge is idempotent. */
function merged3(course: CourseProgress): ProgressDoc {
  return { schema: PROGRESS_SCHEMA, updatedAt: course.updatedAt, courses: { algebra: course }, activity: {}, library: {} };
}
