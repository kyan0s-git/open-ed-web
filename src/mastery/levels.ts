/**
 * Mastery levels.
 *
 * Khan Academy's ladder (attempted -> familiar -> proficient -> mastered) is a good
 * model to borrow, but the signal underneath it here is different: most OCW material
 * has no gradable questions, so level is derived from how durably you have retained
 * something rather than from how many exercises you got right.
 *
 * FSRS gives us stability — the estimated number of days until recall probability
 * falls to 90%. Thresholds are in days, so "proficient" means you would still recall
 * it two weeks later and "mastered" means roughly two months later.
 */

export const LEVELS = [
  { level: 0, label: "Not started", minStabilityDays: null },
  { level: 1, label: "Attempted", minStabilityDays: 0 },
  { level: 2, label: "Familiar", minStabilityDays: 4 },
  { level: 3, label: "Proficient", minStabilityDays: 14 },
  { level: 4, label: "Mastered", minStabilityDays: 60 },
] as const;

export type MasteryLevel = 0 | 1 | 2 | 3 | 4;

export function levelForStability(stabilityDays: number | null | undefined): MasteryLevel {
  if (stabilityDays == null) return 0;

  let level: MasteryLevel = 1;
  for (const entry of LEVELS) {
    if (entry.minStabilityDays !== null && stabilityDays >= entry.minStabilityDays) {
      level = entry.level as MasteryLevel;
    }
  }
  return level;
}

export function levelLabel(level: MasteryLevel): string {
  return LEVELS[level]?.label ?? "Not started";
}

/**
 * Course mastery as a single percentage: the mean level across every skill, including
 * those never started, so the number reflects the whole course rather than only the
 * part already touched.
 */
export function courseMastery(levels: MasteryLevel[]): number {
  if (levels.length === 0) return 0;
  const total = levels.reduce<number>((sum, level) => sum + level, 0);
  return Math.round((total / (levels.length * 4)) * 100);
}
