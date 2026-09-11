import { z } from "zod";

/**
 * The portable progress document.
 *
 * This file is the single source of truth for everything the learner has done. It is
 * plain, versioned JSON so it can be exported, backed up, kept in a synced folder or
 * a git repo, and read by a human. Course content is never copied into it — only
 * references — so it stays small enough to sync.
 */

export const PROGRESS_SCHEMA = "openedweb.progress/1";

/** Beyond this, the oldest attempts per course are dropped to keep the file small. */
export const MAX_ATTEMPTS_PER_COURSE = 500;

export const ItemStatus = z.enum(["unseen", "in_progress", "done"]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const ItemProgress = z.object({
  status: ItemStatus,
  secondsSpent: z.number().nonnegative().default(0),
  updatedAt: z.string(),
});
export type ItemProgress = z.infer<typeof ItemProgress>;

export const SkillProgress = z.object({
  /** 0 unseen, 1 attempted, 2 familiar, 3 proficient, 4 mastered. */
  level: z.number().int().min(0).max(4),
  due: z.string().nullable().default(null),
  reps: z.number().int().nonnegative().default(0),
  lapses: z.number().int().nonnegative().default(0),
  /** Scheduler state, kept opaque so the algorithm can evolve without a migration. */
  fsrs: z
    .object({
      stability: z.number(),
      difficulty: z.number(),
      state: z.number().int(),
      lastReview: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  updatedAt: z.string(),
});
export type SkillProgress = z.infer<typeof SkillProgress>;

export const Attempt = z.object({
  exerciseId: z.string(),
  at: z.string(),
  correct: z.boolean(),
});
export type Attempt = z.infer<typeof Attempt>;

export const Note = z.object({
  text: z.string(),
  updatedAt: z.string(),
});

export const CourseProgress = z.object({
  title: z.string().default(""),
  items: z.record(z.string(), ItemProgress).default({}),
  skills: z.record(z.string(), SkillProgress).default({}),
  attempts: z.array(Attempt).default([]),
  notes: z.record(z.string(), Note).default({}),
  updatedAt: z.string(),
});
export type CourseProgress = z.infer<typeof CourseProgress>;

export const ProgressDoc = z.object({
  schema: z.literal(PROGRESS_SCHEMA),
  updatedAt: z.string(),
  courses: z.record(z.string(), CourseProgress).default({}),
});
export type ProgressDoc = z.infer<typeof ProgressDoc>;

export function emptyProgress(now = new Date()): ProgressDoc {
  return { schema: PROGRESS_SCHEMA, updatedAt: now.toISOString(), courses: {} };
}

export function serializeProgress(doc: ProgressDoc): string {
  // Pretty-printed on purpose: this file is meant to be readable and diffable.
  return JSON.stringify(doc, null, 2) + "\n";
}

export class ProgressFormatError extends Error {}

export function parseProgress(raw: string): ProgressDoc {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new ProgressFormatError("That file is not valid JSON.", { cause });
  }

  const schema = (json as { schema?: unknown } | null)?.schema;
  if (schema !== PROGRESS_SCHEMA) {
    throw new ProgressFormatError(
      `Unrecognised progress format ${JSON.stringify(schema)}; expected ${PROGRESS_SCHEMA}.`,
    );
  }

  const result = ProgressDoc.safeParse(json);
  if (!result.success) {
    throw new ProgressFormatError(`Progress file is malformed: ${result.error.issues[0]?.message}`);
  }
  return result.data;
}

/**
 * Combine two progress documents, record by record.
 *
 * Importing progress from another device must never discard work done on this one, so
 * this merges at the level of individual items, skills and notes — newest timestamp
 * wins — rather than letting either document replace the other wholesale.
 */
export function mergeProgress(base: ProgressDoc, incoming: ProgressDoc): ProgressDoc {
  const courses: ProgressDoc["courses"] = { ...base.courses };

  for (const [courseId, incomingCourse] of Object.entries(incoming.courses)) {
    const existing = courses[courseId];
    if (!existing) {
      courses[courseId] = capAttempts(incomingCourse);
      continue;
    }

    courses[courseId] = capAttempts({
      title: newer(existing.updatedAt, incomingCourse.updatedAt)
        ? existing.title || incomingCourse.title
        : incomingCourse.title || existing.title,
      items: mergeByTimestamp(existing.items, incomingCourse.items),
      skills: mergeByTimestamp(existing.skills, incomingCourse.skills),
      notes: mergeByTimestamp(existing.notes, incomingCourse.notes),
      attempts: mergeAttempts(existing.attempts, incomingCourse.attempts),
      updatedAt: max(existing.updatedAt, incomingCourse.updatedAt),
    });
  }

  return {
    schema: PROGRESS_SCHEMA,
    updatedAt: max(base.updatedAt, incoming.updatedAt),
    courses,
  };
}

function mergeByTimestamp<T extends { updatedAt: string }>(
  base: Record<string, T>,
  incoming: Record<string, T>,
): Record<string, T> {
  const merged: Record<string, T> = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    const existing = merged[key];
    if (!existing || !newer(existing.updatedAt, value.updatedAt)) merged[key] = value;
  }
  return merged;
}

/** Attempts are an append-only log; the same attempt recorded twice is one attempt. */
function mergeAttempts(base: Attempt[], incoming: Attempt[]): Attempt[] {
  const byKey = new Map<string, Attempt>();
  for (const attempt of [...base, ...incoming]) {
    byKey.set(`${attempt.exerciseId}@${attempt.at}`, attempt);
  }
  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
}

function capAttempts(course: CourseProgress): CourseProgress {
  if (course.attempts.length <= MAX_ATTEMPTS_PER_COURSE) return course;
  return { ...course, attempts: course.attempts.slice(-MAX_ATTEMPTS_PER_COURSE) };
}

/** True when `a` is at least as recent as `b`. */
function newer(a: string, b: string): boolean {
  return a >= b;
}

function max(a: string, b: string): string {
  return a >= b ? a : b;
}
