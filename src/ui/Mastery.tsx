/** Four ticks in one hue: level reads as depth rather than as a category. */
export function Mastery({ percent }: { percent: number }) {
  const filled = Math.round((percent / 100) * 4);

  return (
    <span className="mastery">
      <span className="mastery__bar" aria-hidden="true">
        {[1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className="mastery__tick"
            data-level={level}
            data-on={level <= filled ? "1" : "0"}
          />
        ))}
      </span>
      {percent}% mastered
    </span>
  );
}
