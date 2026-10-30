import { useState } from "react";
import type { ExerciseItem } from "@/content/schema";
import { sanitizeCourseHtml } from "@/content/sanitize";
import { describeInterval, gradeAnswer } from "./scheduler";
import { recordAttempt, useCourseProgress, writeSkill } from "./useProgress";

/**
 * Plays the multiple-choice questions extracted from the course.
 *
 * The correct answer is already in the imported markup — the published site hides it
 * until you answer rather than withholding it — so grading happens locally with no
 * lookup. A graded answer feeds the same scheduler as a self-assessment.
 */
export function Quiz({
  courseId,
  courseTitle,
  skillId,
  items,
}: {
  courseId: string;
  courseTitle: string;
  skillId: string;
  items: ExerciseItem[];
}) {
  const progress = useCourseProgress(courseId);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState<string | null>(null);

  const item = items[index];
  if (!item) return null;

  const answer = (choiceIndex: number) => {
    if (chosen !== null) return;
    setChosen(choiceIndex);

    const correct = item.choices[choiceIndex]?.correct ?? false;
    if (correct) setCorrectCount((count) => count + 1);
    recordAttempt(courseId, courseTitle, item.id, correct);
  };

  const next = async () => {
    const isLast = index === items.length - 1;
    if (!isLast) {
      setIndex(index + 1);
      setChosen(null);
      return;
    }

    // Score the whole set once: a majority right counts as recalled.
    const passed = correctCount >= Math.ceil(items.length / 2);
    const updated = gradeAnswer(progress?.skills[skillId], passed);
    await writeSkill(courseId, courseTitle, skillId, updated);
    setFinished(describeInterval(updated));
  };

  if (finished) {
    return (
      <p className="notice" role="status">
        {correctCount} of {items.length} correct. Scheduled again {finished}.
      </p>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Question {index + 1} of {items.length}
      </p>
      <div className="prose" dangerouslySetInnerHTML={{ __html: sanitizeCourseHtml(item.promptHtml) }} />

      <div>
        {item.choices.map((choice, choiceIndex) => (
          <button
            key={choiceIndex}
            type="button"
            className="choice"
            disabled={chosen !== null}
            data-state={
              chosen === null
                ? undefined
                : choice.correct
                  ? "correct"
                  : chosen === choiceIndex
                    ? "wrong"
                    : undefined
            }
            onClick={() => answer(choiceIndex)}
            dangerouslySetInnerHTML={{ __html: sanitizeCourseHtml(choice.html) }}
          />
        ))}
      </div>

      {chosen !== null && (
        <div className="row">
          <button className="btn" type="button" onClick={() => void next()}>
            {index === items.length - 1 ? "Finish" : "Next question"}
          </button>
        </div>
      )}
    </div>
  );
}
