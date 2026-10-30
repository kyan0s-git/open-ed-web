import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useCourse, type LoadedCourse } from "./useCourse";
import { ReaderLayout } from "./ReaderLayout";
import { Html } from "@/content/Html";
import { useCoverUrl } from "@/storage/queries";
import { collectDue, lastVisited, useCourseProgress, useProgress } from "@/mastery/useProgress";
import { courseMastery, type MasteryLevel } from "@/mastery/levels";
import { Level, Meter } from "@/ui/Meter";
import { Icon } from "@/ui/icons";
import { CoverTile } from "@/ui/CourseCard";

const PREVIEW_ROWS = 25;

export function CoursePage() {
  const { courseId } = useParams({ from: "/c/$courseId" });
  const loaded = useCourse(courseId);

  if (loaded === undefined) return <div className="page" />;
  if (loaded === null) {
    return (
      <div className="page page--narrow">
        <h1>Course not found</h1>
        <p className="lede">It may have been removed. Import the archive again to restore it.</p>
        <Link to="/import" className="btn">
          Import a course
        </Link>
      </div>
    );
  }

  return (
    <ReaderLayout loaded={loaded}>
      <Overview loaded={loaded} />
    </ReaderLayout>
  );
}

function Overview({ loaded }: { loaded: LoadedCourse }) {
  const { course, skills } = loaded;
  const cover = useCoverUrl(course);
  const progress = useCourseProgress(course.id);
  const doc = useProgress();

  const inCourse = new Set(course.sequence);
  const finished = Object.entries(progress?.items ?? {}).filter(
    ([uid, item]) => item.status === "done" && inCourse.has(uid),
  ).length;
  const levels = Object.values(progress?.skills ?? {}).map((s) => s.level as MasteryLevel);
  const due = collectDue(doc).filter((d) => d.courseId === course.id).length;

  const last = lastVisited(doc);
  const resumeUid = last?.courseId === course.id && loaded.byUid.has(last.uid) ? last.uid : course.sequence[0];

  return (
    <>
      <div className="hero">
        <div>
          <p className="eyebrow">
            {[course.courseNumber, [course.term, course.year].filter(Boolean).join(" "), course.level.join(", ")]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <h1>{course.title}</h1>
          {course.instructors.length > 0 && (
            <p className="muted" style={{ marginTop: 0 }}>
              {course.instructors.map((person) => person.name).join(", ")}
            </p>
          )}
          {course.topics.length > 0 && (
            <div className="chips">
              {course.topics.map((topic) => (
                <span key={topic} className="chip">
                  {topic}
                </span>
              ))}
            </div>
          )}
          <div className="row">
            {resumeUid && (
              <Link to="/c/$courseId/p/$pageUid" params={{ courseId: course.id, pageUid: resumeUid }} className="btn">
                {last?.courseId === course.id ? "Continue" : "Start the course"} <Icon name="right" />
              </Link>
            )}
            {due > 0 && (
              <Link to="/review" className="btn btn--quiet">
                <Icon name="review" /> {due} due
              </Link>
            )}
            <Link to="/search" search={{ course: course.id }} className="btn btn--quiet">
              <Icon name="search" /> Search this course
            </Link>
          </div>
        </div>

        <div className="card card--pad stack" style={{ gap: "0.9rem" }}>
          <div className="hero__cover">
            {cover ? <img src={cover} alt="" /> : <CoverTile number={course.courseNumber} title={course.title} />}
          </div>
          <Meter label="Materials finished" value={finished} max={course.sequence.length} />
          <Meter label="Skills started" value={levels.length} max={skills.length} />
          <p className="muted" style={{ margin: 0, fontSize: "var(--step--1)" }}>
            {courseMastery(levels, skills.length)}% mastered overall
          </p>
        </div>
      </div>

      {course.descriptionHtml && (
        <section>
          <h2 className="eyebrow">About this course</h2>
          <Html html={course.descriptionHtml} courseId={course.id} pageDir="" maps={loaded.maps} />
        </section>
      )}

      {skills.length > 0 && <Skills loaded={loaded} />}

      <Attribution loaded={loaded} />
    </>
  );
}

/** Everything the review queue can schedule, grouped by kind, with each level. */
function Skills({ loaded }: { loaded: LoadedCourse }) {
  const { course, skills } = loaded;
  const progress = useCourseProgress(course.id);
  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skills) counts.set(skill.kind, (counts.get(skill.kind) ?? 0) + 1);
    return [...counts];
  }, [skills]);

  const [kind, setKind] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const filtered = kind ? skills.filter((s) => s.kind === kind) : skills;
  const shown = expanded ? filtered : filtered.slice(0, PREVIEW_ROWS);

  return (
    <section className="section">
      <div className="section__head">
        <h2>What you will study</h2>
        <span className="muted">{skills.length} skills</span>
      </div>

      {kinds.length > 1 && (
        <div className="tabs" role="group" aria-label="Filter by kind">
          <button type="button" aria-pressed={kind === null} onClick={() => setKind(null)}>
            All
          </button>
          {kinds.map(([name, count]) => (
            <button key={name} type="button" aria-pressed={kind === name} onClick={() => setKind(name)}>
              {name} · {count}
            </button>
          ))}
        </div>
      )}

      <ul className="outline">
        {shown.map((skill) => {
          const done = progress?.items[skill.nodeUid]?.status === "done";
          const level = (progress?.skills[skill.id]?.level ?? 0) as MasteryLevel;
          return (
            <li key={skill.id}>
              <Link to="/c/$courseId/p/$pageUid" params={{ courseId: course.id, pageUid: skill.nodeUid }}>
                <span className="outline__state" data-done={done}>
                  {done && <Icon name="check" size={13} label="Finished" />}
                </span>
                <span>{skill.title}</span>
                <Level level={level} showLabel={false} />
              </Link>
            </li>
          );
        })}
        {filtered.length > shown.length && (
          <li>
            <button
              type="button"
              className="btn btn--quiet"
              style={{ margin: "0.6rem 1rem" }}
              onClick={() => setExpanded(true)}
            >
              Show all {filtered.length}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

/**
 * OCW material is licensed CC BY-NC-SA, which requires attribution. Nothing is
 * re-hosted — the archive stays on this machine — but the reader still says whose work
 * it is and under what terms.
 */
function Attribution({ loaded }: { loaded: LoadedCourse }) {
  const { course } = loaded;
  const people = course.instructors.map((person) => person.name);
  const source = course.sitePath ? `https://ocw.mit.edu/${course.sitePath}/` : "https://ocw.mit.edu";

  return (
    <footer className="notice section">
      <h2>Source and licence</h2>
      <p>
        {course.title}
        {people.length > 0 && <> by {people.join(", ")}</>}, from{" "}
        <a href={source} target="_blank" rel="noopener noreferrer">
          MIT OpenCourseWare
        </a>
        .{" "}
        {course.license ? (
          <a href={course.license} target="_blank" rel="noopener noreferrer">
            Licence terms
          </a>
        ) : (
          "Licensed CC BY-NC-SA."
        )}{" "}
        This reader is not affiliated with MIT.
      </p>
    </footer>
  );
}
