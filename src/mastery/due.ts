import type { SkillProgress } from "@/storage/progress";

/**
 * Whether a skill is due.
 *
 * Deliberately separate from the scheduler: the shell shows a due count on every
 * screen, and a date comparison should not drag the whole scheduling algorithm into
 * the initial payload.
 */
export function isDue(progress: SkillProgress | undefined, now = new Date()): boolean {
  if (!progress?.due) return false;
  return new Date(progress.due) <= now;
}
