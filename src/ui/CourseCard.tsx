import { Link } from "@tanstack/react-router";
import type { ProgressDoc } from "@/storage/progress";
import { useCoverUrl, type CourseSummary } from "@/storage/queries";
import { courseMastery, type MasteryLevel } from "@/mastery/levels";
import { Meter } from "./Meter";

/** A course with its real cover and real progress. */
export function CourseCard({ summary, progress }: { summary: CourseSummary; progress: ProgressDoc }) {
  const { course, skills } = summary;
  const cover = useCoverUrl(course);
  const courseProgress = progress.courses[course.id];
  const inCourse = new Set(course.sequence);
  const finished = Object.entries(courseProgress?.items ?? {}).filter(
    ([uid, item]) => item.status === "done" && inCourse.has(uid),
  ).length;
  const levels = Object.values(courseProgress?.skills ?? {}).map((s) => s.level as MasteryLevel);

  return (
    <Link to="/c/$courseId" params={{ courseId: course.id }} className="card coursecard">
      <div className="coursecard__cover">
        {cover ? <img src={cover} alt="" /> : <CoverTile number={course.courseNumber} title={course.title} />}
      </div>
      <div className="coursecard__body">
        <span className="coursecard__number">
          {[course.courseNumber, [course.term, course.year].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
        </span>
        <span className="coursecard__title">{course.title}</span>
        <Meter label="Finished" value={finished} max={course.sequence.length} />
        <span className="muted" style={{ fontSize: "var(--step--1)" }}>
          {courseMastery(levels, skills.length)}% mastered · {skills.length} skills
        </span>
      </div>
    </Link>
  );
}

/**
 * Shown while a cover loads and when a course has none at all: the course number, set
 * large, so cards stay recognisable rather than leaving an empty box.
 */
export function CoverTile({ number, title }: { number?: string; title: string }) {
  return (
    <span className="covertile" aria-hidden="true">
      <span className="covertile__number">{number || title.slice(0, 1)}</span>
    </span>
  );
}
