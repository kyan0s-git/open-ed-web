import { useState } from "react";
import { describeInterval, reviewSkill, type SelfRating } from "./scheduler";
import { writeSkill } from "./useProgress";
import type { SkillProgress } from "@/storage/progress";

const RATINGS: { rating: SelfRating; label: string; hint: string }[] = [
  { rating: "again", label: "Not yet", hint: "Couldn't recall it" },
  { rating: "hard", label: "Shaky", hint: "Got there with effort" },
  { rating: "good", label: "Solid", hint: "Recalled it" },
  { rating: "easy", label: "Easy", hint: "Knew it cold" },
];

/**
 * The rating a learner gives themselves after reading.
 *
 * This is the path that works for the whole OCW catalogue: almost none of it ships
 * gradable questions, so honest self-assessment is the signal the scheduler gets.
 */
export function SelfAssess({
  courseId,
  courseTitle,
  skillId,
  current,
  onRated,
}: {
  courseId: string;
  courseTitle: string;
  skillId: string;
  current?: SkillProgress;
  onRated?: () => void;
}) {
  const [result, setResult] = useState<SkillProgress | null>(null);

  const rate = async (rating: SelfRating) => {
    const next = reviewSkill(current, rating);
    // Only confirm once it is actually written, so the message never outruns the save.
    await writeSkill(courseId, courseTitle, skillId, next);
    setResult(next);
    onRated?.();
  };

  if (result) {
    return (
      <p className="notice" role="status">
        Scheduled again {describeInterval(result)}.
      </p>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: "var(--step-0)" }}>How well do you know this?</h2>
      <div className="rate">
        {RATINGS.map(({ rating, label, hint }) => (
          <button key={rating} type="button" onClick={() => void rate(rating)}>
            {label}
            <small>{hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
