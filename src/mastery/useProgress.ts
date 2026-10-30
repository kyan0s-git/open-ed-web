import { useSyncExternalStore } from "react";
import { progressStore } from "@/storage/progress-store";
import {
  dayKey,
  trimActivity,
  type CourseProgress,
  type DayActivity,
  type ProgressDoc,
  type SkillProgress,
} from "@/storage/progress";
import { isDue } from "./due";

/**
 * React bindings over the progress document.
 *
 * The store is the source of truth and notifies on every change, so components read
 * through useSyncExternalStore rather than holding their own copies.
 */

const subscribe = (onChange: () => void) => progressStore.subscribe(onChange);

export function useProgress(): ProgressDoc {
  return useSyncExternalStore(subscribe, () => progressStore.doc, () => progressStore.doc);
}

export function useCourseProgress(courseId: string): CourseProgress | undefined {
  return useProgress().courses[courseId];
}

export function useDueCount(now = new Date()): number {
  return collectDue(useProgress(), now).length;
}

export interface DueSkill {
  courseId: string;
  courseTitle: string;
  skillId: string;
  progress: SkillProgress;
}

/** Everything due across every imported course, oldest first. */
export function collectDue(doc: ProgressDoc, now = new Date()): DueSkill[] {
  const due: DueSkill[] = [];
  for (const [courseId, course] of Object.entries(doc.courses)) {
    for (const [skillId, progress] of Object.entries(course.skills)) {
      if (isDue(progress, now)) due.push({ courseId, courseTitle: course.title, skillId, progress });
    }
  }
  return due.sort((a, b) => (a.progress.due ?? "").localeCompare(b.progress.due ?? ""));
}

/**
 * Apply a change to one course, creating its entry on first use, and optionally count
 * it towards today's activity.
 */
function updateCourse(
  courseId: string,
  courseTitle: string,
  change: (course: CourseProgress, now: string) => CourseProgress,
  options: { immediate?: boolean; count?: keyof DayActivity } = {},
): Promise<void> {
  const now = new Date().toISOString();

  return progressStore.update(
    (doc) => {
      const course: CourseProgress = doc.courses[courseId] ?? {
        title: courseTitle,
        items: {},
        skills: {},
        attempts: [],
        notes: {},
        updatedAt: now,
      };

      const next = change({ ...course, title: course.title || courseTitle }, now);
      let activity = doc.activity;
      if (options.count) {
        const today = dayKey();
        const day = activity[today] ?? { reviews: 0, completed: 0 };
        activity = trimActivity({ ...activity, [today]: { ...day, [options.count]: day[options.count] + 1 } });
      }

      return {
        ...doc,
        courses: { ...doc.courses, [courseId]: { ...next, updatedAt: now } },
        activity,
      };
    },
    { immediate: options.immediate },
  );
}

/** Record a review. Earned state, so it is written at once. */
export function writeSkill(
  courseId: string,
  courseTitle: string,
  skillId: string,
  next: SkillProgress,
): Promise<void> {
  return updateCourse(
    courseId,
    courseTitle,
    (course) => ({ ...course, skills: { ...course.skills, [skillId]: next } }),
    { immediate: true, count: "reviews" },
  );
}

export function recordAttempt(
  courseId: string,
  courseTitle: string,
  exerciseId: string,
  correct: boolean,
): Promise<void> {
  return updateCourse(
    courseId,
    courseTitle,
    (course, at) => ({ ...course, attempts: [...course.attempts, { exerciseId, at, correct }] }),
    { immediate: true },
  );
}

/**
 * Mark a page or material as opened or finished. Reading is tracked separately from
 * skills: having read something is not the same as being able to recall it.
 */
export function markItem(
  courseId: string,
  courseTitle: string,
  uid: string,
  status: "in_progress" | "done",
  secondsSpent = 0,
): Promise<void> {
  const previous = progressStore.doc.courses[courseId]?.items[uid];
  // Opening something already finished must not demote it back to "in progress".
  const nextStatus = previous?.status === "done" && status === "in_progress" ? "done" : status;
  const finishing = nextStatus === "done" && previous?.status !== "done";

  return updateCourse(
    courseId,
    courseTitle,
    (course, now) => ({
      ...course,
      items: {
        ...course.items,
        [uid]: {
          status: nextStatus,
          secondsSpent: (previous?.secondsSpent ?? 0) + secondsSpent,
          updatedAt: now,
        },
      },
    }),
    { immediate: finishing, count: finishing ? "completed" : undefined },
  );
}

/** Undo a "done" mark. */
export function unmarkItem(courseId: string, courseTitle: string, uid: string): Promise<void> {
  return updateCourse(
    courseId,
    courseTitle,
    (course, now) => ({
      ...course,
      items: {
        ...course.items,
        [uid]: { status: "in_progress", secondsSpent: course.items[uid]?.secondsSpent ?? 0, updatedAt: now },
      },
    }),
    { immediate: true },
  );
}

/** The most recently opened item anywhere, for "continue where you left off". */
export function lastVisited(doc: ProgressDoc): { courseId: string; uid: string; at: string } | null {
  let best: { courseId: string; uid: string; at: string } | null = null;
  for (const [courseId, course] of Object.entries(doc.courses)) {
    for (const [uid, item] of Object.entries(course.items)) {
      if (!best || item.updatedAt > best.at) best = { courseId, uid, at: item.updatedAt };
    }
  }
  return best;
}

/**
 * Consecutive days with any activity, ending today — or yesterday, so a streak is not
 * shown as broken before the learner has had a chance to study today.
 */
export function currentStreak(doc: ProgressDoc, now = new Date()): number {
  const active = (date: Date) => {
    const day = doc.activity[dayKey(date)];
    return Boolean(day && day.reviews + day.completed > 0);
  };

  const cursor = new Date(now);
  if (!active(cursor)) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (active(cursor)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
