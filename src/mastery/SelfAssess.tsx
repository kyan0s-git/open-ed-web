import { useState } from "react";
import { describeInterval, levelOf, reviewSkill, type SelfRating } from "./scheduler";
import { writeSkill } from "./useProgress";
import type { SkillProgress } from "@/storage/progress";
import { Level } from "@/ui/Meter";

const RATINGS: { rating: SelfRating; label: string; hint: string }[] = [
  { rating: "again", label: "Not yet", hint: "Couldn't recall it" },
  { rating: "hard", label: "Shaky", hint: "Got there with effort" },
  { rating: "good", label: "Solid", hint: "Recalled it" },
  { rating: "easy", label: "Easy", hint: "Knew it cold" },
];

/**
 * The rating a learner gives themselves after studying something.
 *
 * This is the path that works across the whole OCW catalogue: almost none of it ships
 * gradable questions, so honest self-assessment is the signal the scheduler gets.
 */
export function SelfAssess({
  courseId,
  courseTitle,
  skillId,
  current,
  onRated,
  prompt = "How well do you know this?",
}: {
  courseId: string;
  courseTitle: string;
  skillId: string;
  current?: SkillProgress;
  onRated?: () => void;
  prompt?: string;
}) {
  const [result, setResult] = useState<SkillProgress | null>(null);
  const [saving, setSaving] = useState(false);

  const rate = async (rating: SelfRating) => {
    setSaving(true);
    const next = reviewSkill(current, rating);
    // Confirm only once it is written, so the message never outruns the save.
    await writeSkill(courseId, courseTitle, skillId, next);
    setResult(next);
    setSaving(false);
    onRated?.();
  };

  if (result) {
    return (
      <div className="card assess" role="status">
        <h2>Saved</h2>
        <p className="muted" style={{ margin: "0.25rem 0 0.6rem" }}>
          You will see this again {describeInterval(result)}.
        </p>
        <Level level={levelOf(result)} />
      </div>
    );
  }

  return (
    <div className="card assess">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>{prompt}</h2>
        {current && <Level level={levelOf(current)} />}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: "var(--step--1)" }}>
        Your answer schedules the next review: the better you know it, the longer until it comes back.
      </p>
      <div className="rate">
        {RATINGS.map(({ rating, label, hint }) => (
          <button key={rating} type="button" disabled={saving} onClick={() => void rate(rating)}>
            {label}
            <small>{hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
