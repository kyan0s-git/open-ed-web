import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Course } from "@/content/schema";
import { listCourses } from "@/storage/db";
import { useProgress } from "@/mastery/useProgress";
import { courseMastery, type MasteryLevel } from "@/mastery/levels";
import { Mastery } from "@/ui/Mastery";

export function LibraryPage() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const progress = useProgress();

  useEffect(() => {
    let live = true;
    listCourses().then((rows) => live && setCourses(rows));
    return () => {
      live = false;
    };
  }, []);

  if (courses === null) return <div className="page" />;

  if (courses.length === 0) {
    return (
      <div className="page">
        <h1>No courses yet</h1>
        <p className="lede">
          Download a course from MIT OpenCourseWare and drop the <code>.zip</code> in. It stays
          on this machine — nothing is uploaded.
        </p>
        <Link to="/import" className="btn">
          Import a course
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Courses</h1>
      <p className="lede">{courses.length} imported.</p>

      <ul className="library">
        {courses.map((course) => {
          const skills = progress.courses[course.id]?.skills ?? {};
          const levels = Object.values(skills).map((s) => s.level as MasteryLevel);

          return (
            <li key={course.id}>
              <Link to="/c/$courseId" params={{ courseId: course.id }}>
                <span className="library__title">{course.title}</span>
                <Mastery percent={courseMastery(levels)} />
                <span className="library__meta">
                  {[course.courseNumber, [course.term, course.year].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
