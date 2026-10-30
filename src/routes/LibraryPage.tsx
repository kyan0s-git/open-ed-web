import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useCourseSummaries } from "@/storage/queries";
import { useProgress } from "@/mastery/useProgress";
import { CourseCard } from "@/ui/CourseCard";
import { Icon } from "@/ui/icons";
import { ServerOnlyCourses } from "@/sync/CourseTransfer";

export function LibraryPage() {
  const summaries = useCourseSummaries();
  const progress = useProgress();
  const [query, setQuery] = useState("");

  if (summaries === null) return <div className="page" />;

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? summaries.filter(({ course }) =>
        [course.title, course.courseNumber, ...course.topics, ...course.instructors.map((i) => i.name)]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(needle)),
      )
    : summaries;

  return (
    <div className="page">
      <div className="dash-head">
        <div>
          <p className="eyebrow">Library</p>
          <h1>Courses</h1>
        </div>
        <Link to="/import" className="btn">
          <Icon name="upload" /> Import a course
        </Link>
      </div>

      <ServerOnlyCourses localIds={new Set(summaries.map(({ course }) => course.id))} />

      {summaries.length === 0 ? (
        <p className="empty">
          No courses yet. <Link to="/import">Import one</Link> to get started.
        </p>
      ) : (
        <>
          {summaries.length > 3 && (
            <input
              type="search"
              className="search"
              placeholder="Filter by title, number, topic or instructor"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Filter courses"
            />
          )}
          <div className="coursecards">
            {shown.map((summary) => (
              <CourseCard key={summary.course.id} summary={summary} progress={progress} />
            ))}
          </div>
          {shown.length === 0 && <p className="empty">No course matches “{query}”.</p>}
        </>
      )}
    </div>
  );
}
