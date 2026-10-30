import { useEffect, useState } from "react";
import type { Course, Skill } from "@/content/schema";
import { db } from "./db";
import { assetUrl } from "@/content/assets";
import { guessMime } from "@/content/maps";

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

export function useCourseSummaries(): CourseSummary[] | null {
  const [summaries, setSummaries] = useState<CourseSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadCourseSummaries().then((rows) => live && setSummaries(rows));
    return () => {
      live = false;
    };
  }, []);
  return summaries;
}

/** The course's cover image from inside its archive, as a blob URL. */
export function useCoverUrl(course: Course | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const courseId = course?.id;
  const imagePath = course?.imagePath;

  useEffect(() => {
    if (!courseId || !imagePath) return;
    let live = true;
    void assetUrl(courseId, imagePath, guessMime(imagePath) ?? "image/jpeg")
      .then((next) => live && setUrl(next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [courseId, imagePath]);

  return url;
}
