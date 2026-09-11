import { Rating, State, createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";
import type { SkillProgress } from "@/storage/progress";
import { levelForStability, type MasteryLevel } from "./levels";

export { isDue } from "./due";

/**
 * Review scheduling.
 *
 * Two kinds of evidence feed the same scheduler: a self-assessment, where the learner
 * rates their own recall, and a graded attempt on one of the multiple-choice questions
 * extracted from the course. Grading a question maps onto the same four-point scale, so
 * both paths produce comparable scheduling state.
 */

export type SelfRating = "again" | "hard" | "good" | "easy";

const RATINGS: Record<SelfRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const scheduler = fsrs();

/** Rebuild scheduler state from what the progress file stored. */
function toCard(progress: SkillProgress | undefined, now: Date): Card {
  if (!progress?.fsrs) return createEmptyCard(now);

  return {
    due: progress.due ? new Date(progress.due) : now,
    stability: progress.fsrs.stability,
    difficulty: progress.fsrs.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: progress.reps,
    lapses: progress.lapses,
    state: progress.fsrs.state as State,
    last_review: progress.fsrs.lastReview ? new Date(progress.fsrs.lastReview) : undefined,
  };
}

export function reviewSkill(
  progress: SkillProgress | undefined,
  rating: SelfRating,
  now = new Date(),
): SkillProgress {
  const { card } = scheduler.next(toCard(progress, now), now, RATINGS[rating]);

  return {
    level: levelForStability(card.stability),
    due: card.due.toISOString(),
    reps: card.reps,
    lapses: card.lapses,
    fsrs: {
      stability: card.stability,
      difficulty: card.difficulty,
      state: card.state,
      lastReview: (card.last_review ?? now).toISOString(),
    },
    updatedAt: now.toISOString(),
  };
}

/** A graded answer is evidence too: right is "good", wrong is "again". */
export function gradeAnswer(
  progress: SkillProgress | undefined,
  correct: boolean,
  now = new Date(),
): SkillProgress {
  return reviewSkill(progress, correct ? "good" : "again", now);
}

export function levelOf(progress: SkillProgress | undefined): MasteryLevel {
  return (progress?.level ?? 0) as MasteryLevel;
}

/** How long until this is due again, for showing the effect of an answer. */
export function describeInterval(progress: SkillProgress, now = new Date()): string {
  if (!progress.due) return "not scheduled";

  const days = Math.round((new Date(progress.due).getTime() - now.getTime()) / 86_400_000);
  if (days < 1) return "later today";
  if (days === 1) return "tomorrow";
  if (days < 30) return `in ${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? "in a month" : `in ${months} months`;
}
