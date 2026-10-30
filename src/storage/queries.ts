import { useEffect, useState } from "react";
import type { Course, Skill } from "@/content/schema";
import { db } from "./db";

export interface CourseSummary {
  course: Course;
  skills: Skill[];
}

/** Every imported course with its skills, newest import first. */
export async function loadCourseSummaries(): Promise<CourseSummary[]> {
  const [courses, skills] = await Promise.all([
    db.courses.orderBy("importedAt").reverse().toArray(),
    db.skills.toArray(),
  ]);

  const byCourse = new Map<string, Skill[]>();
  for (const skill of skills) {
    const list = byCourse.get(skill.courseId) ?? [];
    list.push(skill);
    byCourse.set(skill.courseId, list);
  }

  return courses.map((course) => ({
    course,
    skills: (byCourse.get(course.id) ?? []).sort((a, b) => a.order - b.order),
  }));
}

const courseListeners = new Set<() => void>();

/** Tell open lists that a course was added or removed somewhere other than their screen. */
export function coursesChanged(): void {
  for (const listener of courseListeners) listener();
}

/** Re-run `load` whenever coursesChanged() is called. */
export function onCoursesChanged(load: () => void): () => void {
  courseListeners.add(load);
  return () => courseListeners.delete(load);
}

export function useCourseSummaries(): CourseSummary[] | null {
  const [summaries, setSummaries] = useState<CourseSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void loadCourseSummaries().then((rows) => live && setSummaries(rows));
    load();
    const unsubscribe = onCoursesChanged(load);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return summaries;
}

/**
 * The course's cover as a blob URL: its own image, or a rendered first page of its
 * notes when it has none that decodes (see content/thumbnails.ts). Null while loading
 * and when there is nothing to show, in which case cards draw a typographic tile.
 */
export function useCoverUrl(course: Course | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!course) return;
    let live = true;
    let created: string | null = null;
    void import("@/content/thumbnails")
      .then(({ courseCover }) => courseCover(course))
      .then((image) => {
        if (!live || !image) return;
        created = URL.createObjectURL(image);
        setUrl(created);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [course?.id, course?.imagePath]);

  return url;
}
