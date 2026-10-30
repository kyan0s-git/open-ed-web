import { useEffect, useState } from "react";
import { useProgress } from "@/mastery/useProgress";
import { formatBytes } from "@/content/ResourceView";
import { Icon } from "@/ui/icons";
import type { LibraryEntry } from "@/storage/progress";
import {
  dismissError,
  downloadCourse,
  libraryEntries,
  setLibrarySettings,
  useLibraryState,
  type Transfer,
} from "./library";

/** Courses in the library that this device does not have yet, with Download. */
export function MissingCourses({ localIds }: { localIds: Set<string> }) {
  const doc = useProgress();
  const { transfers } = useLibraryState();
  const missing = Object.entries(libraryEntries(doc)).filter(([id]) => !localIds.has(id));
  if (missing.length === 0) return null;

  return (
    <section className="section stack">
      <div className="section__head">
        <h2>In your library, not on this device</h2>
        <span className="muted">From your other devices</span>
      </div>
      <ul className="list">
        {missing.map(([id, entry]) => (
          <li key={id}>
            <span>
              <strong>{entry.title}</strong>
              <span className="muted">
                {entry.courseNumber ? ` · ${entry.courseNumber}` : ""}
                {entry.bytes ? ` · ${formatBytes(entry.bytes)}` : ""}
              </span>
            </span>
            <MissingAction id={id} entry={entry} transfer={transfers.get(id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MissingAction({ id, entry, transfer }: { id: string; entry: LibraryEntry; transfer?: Transfer }) {
  if (transfer) return <TransferStatus id={id} transfer={transfer} />;
  if (!entry.sourceUrl) {
    return <span className="muted" style={{ fontSize: "var(--step--1)" }}>Import its .zip on this device</span>;
  }
  return (
    <button className="btn" type="button" onClick={() => void downloadCourse(id).catch(() => {})}>
      <Icon name="download" /> Download
    </button>
  );
}

const PHASE = { downloading: "Downloading", importing: "Importing" } as const;

function TransferStatus({ id, transfer }: { id: string; transfer: Transfer }) {
  if (transfer.error) {
    return (
      <span className="transfer transfer--error" role="alert">
        {transfer.error}
        <button className="btn btn--quiet" type="button" onClick={() => dismissError(id)}>
          Dismiss
        </button>
      </span>
    );
  }
  const percent = transfer.total ? Math.min(100, Math.round((transfer.done / transfer.total) * 100)) : null;
  return (
    <span className="transfer" role="status">
      <span>
        {PHASE[transfer.phase]} {percent === null ? formatBytes(transfer.done) : `${percent}%`}
      </span>
      <span className="progressbar transfer__bar" aria-hidden="true">
        <span style={{ width: `${percent ?? 0}%` }} />
      </span>
    </span>
  );
}

const LIMITS = [
  { value: 100, label: "up to 100 MB" },
  { value: 250, label: "up to 250 MB" },
  { value: 500, label: "up to 500 MB" },
  { value: 1000, label: "up to 1 GB" },
  { value: 0, label: "of any size" },
];

/** Settings: how this device keeps up with the library. */
export function LibrarySettingsPanel({ syncing }: { syncing: boolean }) {
  const { settings } = useLibraryState();
  const doc = useProgress();
  const [count, setCount] = useState(0);
  useEffect(() => setCount(Object.keys(libraryEntries(doc)).length), [doc]);

  return (
    <section className="section stack">
      <h2 style={{ margin: 0 }}>Course library</h2>
      <p className="muted" style={{ margin: 0 }}>
        Your library lists every course you have imported on any device: {count === 1 ? "1 course" : `${count} courses`}{" "}
        so far. It is part of your progress file, so {syncing ? "it syncs with it" : "it travels with it when you turn on sync"},
        and it records where each course can be downloaded rather than the course itself. Devices fetch OCW courses
        straight from ocw.mit.edu.
      </p>
      <fieldset className="options">
        <legend>On this device</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoDownload}
            onChange={(event) => setLibrarySettings({ autoDownload: event.target.checked })}
          />
          <span>
            <strong>Download courses from my library automatically</strong>
            <small>
              When another device adds a course, download it here too. Courses you remove from this device are not
              downloaded again.
            </small>
          </span>
        </label>
        {settings.autoDownload && (
          <label className="field field--inline options__more">
            <span>Download courses</span>
            <select
              className="select"
              value={settings.maxMB}
              onChange={(event) => setLibrarySettings({ maxMB: Number(event.target.value) })}
            >
              {LIMITS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
    </section>
  );
}
