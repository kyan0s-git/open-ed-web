import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { CourseNode } from "@/content/schema";
import { db } from "@/storage/db";
import { dayKey, type ProgressDoc } from "@/storage/progress";
import { useCourseSummaries, type CourseSummary } from "@/storage/queries";
import { CourseCard } from "@/ui/CourseCard";
import { collectDue, currentStreak, lastVisited, useProgress } from "@/mastery/useProgress";
import { courseMastery, type MasteryLevel } from "@/mastery/levels";
import { Icon } from "@/ui/icons";

/**
 * The home screen answers three questions, in order: what is due, where was I, and
 * how am I doing. Everything on it is computed from progress.json and the course
 * cache — nothing is stored just to draw this page.
 */
export function DashboardPage() {
  const summaries = useCourseSummaries();
  const progress = useProgress();

  if (summaries === null) return <div className="page" />;
  if (summaries.length === 0) return <Welcome />;

  return <Dashboard summaries={summaries} progress={progress} />;
}

function Dashboard({ summaries, progress }: { summaries: CourseSummary[]; progress: ProgressDoc }) {
  const due = collectDue(progress);
  const streak = currentStreak(progress);
  const today = progress.activity[dayKey()];

  const totals = useMemo(() => {
    let finished = 0;
    let materials = 0;
    let skills = 0;
    const levels: MasteryLevel[] = [];

    for (const { course, skills: courseSkills } of summaries) {
      const items = progress.courses[course.id]?.items ?? {};
      const inCourse = new Set(course.sequence);
      materials += course.sequence.length;
      finished += Object.entries(items).filter(([uid, item]) => item.status === "done" && inCourse.has(uid)).length;
      skills += courseSkills.length;
      for (const skill of Object.values(progress.courses[course.id]?.skills ?? {})) {
        levels.push(skill.level as MasteryLevel);
      }
    }
    return { finished, materials, mastery: courseMastery(levels, skills), started: levels.length, skills };
  }, [summaries, progress]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="page">
      <div className="dash-head">
        <div>
          <p className="eyebrow">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1>{greeting}</h1>
        </div>
        {due.length > 0 && (
          <Link to="/review" className="btn">
            <Icon name="review" /> Review {due.length} due
          </Link>
        )}
      </div>

      <section className="stats" aria-label="Your stats">
        <Stat
          className="stat--due"
          label="Due for review"
          value={due.length}
          note={due.length > 0 ? "Oldest first in Review" : "Nothing waiting"}
        />
        <Stat
          label="Day streak"
          value={streak}
          note={today && today.reviews + today.completed > 0 ? "Studied today" : "Study today to extend it"}
        />
        <Stat
          label="Materials finished"
          value={totals.finished}
          note={`of ${totals.materials} across ${summaries.length} ${summaries.length === 1 ? "course" : "courses"}`}
        />
        <Stat
          label="Overall mastery"
          value={`${totals.mastery}%`}
          note={`${totals.started} of ${totals.skills} skills started`}
        />
      </section>

      <div className="dash-grid">
        <Continue progress={progress} summaries={summaries} />
        <Activity progress={progress} />
      </div>

      <section className="section">
        <div className="section__head">
          <h2>Your courses</h2>
          <Link to="/import">Import another</Link>
        </div>
        <div className="coursecards">
          {summaries.map((summary) => (
            <CourseCard key={summary.course.id} summary={summary} progress={progress} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  className = "",
}: {
  label: string;
  value: number | string;
  note: string;
  className?: string;
}) {
  return (
    <div className={`card stat ${className}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      <span className="stat__note">{note}</span>
    </div>
  );
}

/** Where you were, and what comes after it in the course. */
function Continue({ progress, summaries }: { progress: ProgressDoc; summaries: CourseSummary[] }) {
  const last = lastVisited(progress);
  const summary = summaries.find((s) => s.course.id === last?.courseId) ?? summaries[0];
  const [node, setNode] = useState<CourseNode | null>(null);
  const [next, setNext] = useState<CourseNode | null>(null);

  const course = summary?.course;
  const sequence = course?.sequence ?? [];
  const lastUid = last && course && last.courseId === course.id ? last.uid : null;

  useEffect(() => {
    if (!course) return;
    let live = true;
    const index = lastUid ? sequence.indexOf(lastUid) : -1;
    const currentUid = lastUid ?? sequence[0];
    const nextUid = index >= 0 ? sequence[index + 1] : undefined;

    void Promise.all([
      currentUid ? db.nodes.get(currentUid) : undefined,
      nextUid ? db.nodes.get(nextUid) : undefined,
    ]).then(([current, after]) => {
      if (!live) return;
      setNode(current ?? null);
      setNext(after ?? null);
    });
    return () => {
      live = false;
    };
  }, [course, lastUid, sequence]);

  if (!course || !node) return <div className="card card--pad" />;

  return (
    <div className="card card--pad continue">
      <p className="eyebrow">{lastUid ? "Continue where you left off" : "Start here"}</p>
      <h2 className="continue__title">{node.title}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {course.courseNumber ? `${course.courseNumber} · ` : ""}
        {course.title}
      </p>
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <Link to="/c/$courseId/p/$pageUid" params={{ courseId: course.id, pageUid: node.uid }} className="btn">
          {lastUid ? "Resume" : "Begin"} <Icon name="right" />
        </Link>
        {next && (
          <Link
            to="/c/$courseId/p/$pageUid"
            params={{ courseId: course.id, pageUid: next.uid }}
            className="btn btn--quiet"
          >
            Up next: {truncate(next.title, 36)}
          </Link>
        )}
      </div>
    </div>
  );
}

/** The last two weeks, one bar per day. */
function Activity({ progress }: { progress: ProgressDoc }) {
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - i));
    const entry = progress.activity[dayKey(date)];
    return { date, count: entry ? entry.reviews + entry.completed : 0 };
  });
  const peak = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="card card--pad">
      <p className="eyebrow">Last 14 days</p>
      <p style={{ margin: 0 }}>
        <strong>{total}</strong> <span className="muted">reviews and finished materials</span>
      </p>
      <div className="activity" role="img" aria-label={`Activity over the last 14 days: ${total} in total.`}>
        {days.map(({ date, count }, i) => (
          <div
            key={i}
            className="activity__bar"
            data-on={count > 0}
            data-today={i === 13}
            style={{ height: `${Math.max(4, (count / peak) * 100)}%` }}
            title={`${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${count}`}
          />
        ))}
      </div>
      <div className="activity__axis" aria-hidden="true">
        <span>{days[0]?.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="page page--narrow">
      <p className="eyebrow">Welcome</p>
      <h1>Study MIT OpenCourseWare like a course, not a folder</h1>
      <p className="lede">
        Drop in a course archive and it becomes a structured course: lectures in order, notes and
        videos in place, and a review queue that brings back what you are about to forget. It all
        stays on this machine.
      </p>
      <Link to="/import" className="btn">
        <Icon name="upload" /> Import your first course
      </Link>
      <ol className="steps">
        <li>On any course at ocw.mit.edu, choose “Download course” to get its .zip.</li>
        <li>Import it here. Nothing is uploaded; the archive is stored in your browser.</li>
        <li>Read, rate what you learned, and come back when reviews are due.</li>
      </ol>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
