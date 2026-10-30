import type { MasteryLevel } from "@/mastery/levels";
import { levelLabel } from "@/mastery/levels";

/** A labelled progress bar. */
export function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="meter">
      <div className="meter__row">
        <span>{label}</span>
        <span>
          {value} / {max}
        </span>
      </div>
      <div
        className="meter__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className="meter__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Four dots in one hue: a skill's level reads as depth, not as a category. */
export function Level({ level, showLabel = true }: { level: MasteryLevel; showLabel?: boolean }) {
  return (
    <span className="level" data-level={level} title={levelLabel(level)}>
      <span className="level__dots" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className="level__dot" data-on={step <= level} />
        ))}
      </span>
      {showLabel ? levelLabel(level) : <span className="sr-only">{levelLabel(level)}</span>}
    </span>
  );
}
