import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { db } from "@/storage/db";
import type { Skill } from "@/content/schema";
import { collectDue, useProgress } from "@/mastery/useProgress";
import { SelfAssess } from "@/mastery/SelfAssess";
import { levelLabel } from "@/mastery/levels";

/**
 * One queue across every imported course.
 *
 * Reviewing is the habit this whole thing is built around, so it deliberately does not
 * ask which course to study — it asks what is due today, oldest first.
 */
export function ReviewPage() {
  const progress = useProgress();
  const [skills, setSkills] = useState<Map<string, Skill>>(new Map());

  const due = useMemo(() => collectDue(progress), [progress]);

  useEffect(() => {
    void db.skills.toArray().then((rows) => setSkills(new Map(rows.map((s) => [s.id, s]))));
  }, []);

  const current = due[0];

  if (!current) {
    return (
      <div className="page">
        <h1>Nothing due</h1>
        <p className="lede">
          Reviews appear here when they come up. Read something new in the meantime and rate it
          — that is what puts it in the queue.
        </p>
        <Link to="/" className="btn btn--quiet">
          Back to courses
        </Link>
      </div>
    );
  }

  const skill = skills.get(current.skillId);
  const pageUid = skill?.nodeUid;

  return (
    <div className="page">
      <h1>Review</h1>
      <p className="lede">
        {due.length} due · {current.courseTitle}
      </p>

      <div className="stack">
        <h2 style={{ margin: 0 }}>{skill?.title ?? "Untitled"}</h2>
        <p className="resources__kind">Currently {levelLabel(current.progress.level as 0)}</p>

        {pageUid && (
          <Link
            to="/c/$courseId/p/$pageUid"
            params={{ courseId: current.courseId, pageUid }}
            className="btn btn--quiet"
          >
            Open the material
          </Link>
        )}

        <SelfAssess
          key={current.skillId}
          courseId={current.courseId}
          courseTitle={current.courseTitle}
          skillId={current.skillId}
          current={current.progress}
        />
      </div>
    </div>
  );
}
