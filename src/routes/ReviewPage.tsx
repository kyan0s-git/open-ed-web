import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { db } from "@/storage/db";
import type { Skill } from "@/content/schema";
import { collectDue, useProgress } from "@/mastery/useProgress";
import { SelfAssess } from "@/mastery/SelfAssess";
import { describeInterval } from "@/mastery/scheduler";
import { Icon } from "@/ui/icons";

/**
 * One queue across every imported course.
 *
 * Reviewing is the habit this is built around, so it does not ask which course to
 * study — it asks what is due, oldest first, one at a time.
 */
export function ReviewPage() {
  const progress = useProgress();
  const [skills, setSkills] = useState<Map<string, Skill> | null>(null);
  const [done, setDone] = useState(0);

  const due = useMemo(() => collectDue(progress), [progress]);

  useEffect(() => {
    void db.skills.toArray().then((rows) => setSkills(new Map(rows.map((s) => [s.id, s]))));
  }, []);

  if (!skills) return <div className="page" />;

  // Skip anything whose course has since been removed.
  const queue = due.filter((item) => skills.has(item.skillId));
  const current = queue[0];

  if (!current) {
    const upcoming = Object.values(progress.courses)
      .flatMap((course) => Object.values(course.skills))
      .filter((skill) => skill.due)
      .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))[0];

    return (
      <div className="page page--narrow">
        <p className="eyebrow">Review</p>
        <h1>{done > 0 ? "All caught up" : "Nothing due"}</h1>
        <p className="lede">
          {done > 0 && `You reviewed ${done} ${done === 1 ? "item" : "items"}. `}
          {upcoming
            ? `The next review comes up ${describeInterval(upcoming)}.`
            : "Study a lecture and rate how well you know it — that is what puts it in the queue."}
        </p>
        <Link to="/" className="btn btn--quiet">
          <Icon name="home" /> Back to the dashboard
        </Link>
      </div>
    );
  }

  const skill = skills.get(current.skillId)!;

  return (
    <div className="page page--narrow">
      <div className="dash-head">
        <div>
          <p className="eyebrow">Review · {queue.length} due</p>
          <h1>{skill.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {skill.kind} · {current.courseTitle}
          </p>
        </div>
      </div>

      <div className="stack" style={{ maxWidth: "none" }}>
        <div className="card reviewcard">
          <p style={{ margin: 0 }}>
            Try to recall the main ideas before you look. Then rate yourself honestly — the schedule only
            works if the ratings are true.
          </p>
          <div className="row">
            <Link
              to="/c/$courseId/p/$pageUid"
              params={{ courseId: current.courseId, pageUid: skill.nodeUid }}
              className="btn btn--quiet"
            >
              <Icon name="external" /> Open the material
            </Link>
          </div>
        </div>

        <SelfAssess
          key={current.skillId}
          courseId={current.courseId}
          courseTitle={current.courseTitle}
          skillId={current.skillId}
          current={current.progress}
          onRated={() => setDone((count) => count + 1)}
        />
      </div>
    </div>
  );
}
