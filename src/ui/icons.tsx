/**
 * The handful of icons the interface needs, drawn inline.
 *
 * An icon library would be the largest dependency in the shell for about fifteen
 * glyphs. These are 24-unit strokes that inherit currentColor, so they follow the
 * theme and the surrounding text.
 */

const PATHS = {
  home: "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z",
  courses: "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z",
  review: "M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4",
  upload: "M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L3 9.3l2-3.4 1.9.7a7 7 0 0 1 1.7-1l.3-2h4l.3 2a7 7 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  system: "M4 5h16v11H4zM9 20h6m-3-4v4",
  left: "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  play: "M8 5.5v13l11-6.5z",
  file: "M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5zM14 3v4.5h4.5",
  external: "M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10",
  download: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.6-4.6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  sync: "M20 8a8 8 0 0 0-14.3-2.6M4 4v4h4M4 16a8 8 0 0 0 14.3 2.6M20 20v-4h-4",
  copy: "M9 9h10.5A1.5 1.5 0 0 1 21 10.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 9 19.5zM15 9V4.5A1.5 1.5 0 0 0 13.5 3h-9A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H9",
  flame: "M12 21a6 6 0 0 0 6-6c0-4-3-5.5-3.5-9.5C12 7 10.5 9.5 10.5 11 9.5 10 9 9 9 8 7 10 6 12.5 6 15a6 6 0 0 0 6 6z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  label,
}: {
  name: IconName;
  size?: number;
  /** Give a label only when the icon carries meaning on its own. */
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === "play" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className="icon"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
