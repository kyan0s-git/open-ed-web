import { useSyncExternalStore } from "react";
import { progressStore } from "@/storage/progress-store";
import type { CourseProgress, ProgressDoc, SkillProgress } from "@/storage/progress";
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
  const doc = useProgress();
  let count = 0;
  for (const course of Object.values(doc.courses)) {
    for (const skill of Object.values(course.skills)) {
      if (isDue(skill, now)) count += 1;
    }
  }
  return count;
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
      if (isDue(progress, now)) {
        due.push({ courseId, courseTitle: course.title, skillId, progress });
      }
    }
  }

  return due.sort((a, b) => (a.progress.due ?? "").localeCompare(b.progress.due ?? ""));
}

/** Record a change to one skill, creating the course entry if this is the first. */
export function writeSkill(
  courseId: string,
  courseTitle: string,
  skillId: string,
  next: SkillProgress,
): Promise<void> {
  return progressStore.update((doc) => {
    const course = doc.courses[courseId] ?? {
      title: courseTitle,
      items: {},
      skills: {},
      attempts: [],
      notes: {},
      updatedAt: next.updatedAt,
    };

    return {
      ...doc,
      courses: {
        ...doc.courses,
        [courseId]: {
          ...course,
          title: course.title || courseTitle,
          skills: { ...course.skills, [skillId]: next },
          updatedAt: next.updatedAt,
        },
      },
    };
  }, { immediate: true });
}

export function recordAttempt(
  courseId: string,
  courseTitle: string,
  exerciseId: string,
  correct: boolean,
  at = new Date().toISOString(),
): Promise<void> {
  return progressStore.update((doc) => {
    const course = doc.courses[courseId] ?? {
      title: courseTitle,
      items: {},
      skills: {},
      attempts: [],
      notes: {},
      updatedAt: at,
    };

    return {
      ...doc,
      courses: {
        ...doc.courses,
        [courseId]: {
          ...course,
          attempts: [...course.attempts, { exerciseId, at, correct }],
          updatedAt: at,
        },
      },
    };
  }, { immediate: true });
}

/** Mark a page read. Kept separate from skills: reading is not the same as recall. */
export function markItem(
  courseId: string,
  courseTitle: string,
  uid: string,
  status: "in_progress" | "done",
  secondsSpent = 0,
): Promise<void> {
  const now = new Date().toISOString();

  return progressStore.update((doc) => {
    const course = doc.courses[courseId] ?? {
      title: courseTitle,
      items: {},
      skills: {},
      attempts: [],
      notes: {},
      updatedAt: now,
    };
    const previous = course.items[uid];

    return {
      ...doc,
      courses: {
        ...doc.courses,
        [courseId]: {
          ...course,
          title: course.title || courseTitle,
          items: {
            ...course.items,
            [uid]: {
              status,
              secondsSpent: (previous?.secondsSpent ?? 0) + secondsSpent,
              updatedAt: now,
            },
          },
          updatedAt: now,
        },
      },
    };
  }, { immediate: status === "done" });
}
