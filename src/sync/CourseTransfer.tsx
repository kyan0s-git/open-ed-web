import { useEffect, useState } from "react";
import { useProgress } from "@/mastery/useProgress";
import { formatBytes } from "@/content/ResourceView";
import { Icon } from "@/ui/icons";
import { syncEngine } from "./engine";
import { useSyncStatus } from "./useSync";
import {
  clearTransferError,
  downloadCourse,
  removeStoredCourse,
  storedCourses,
  uploadCourse,
  useTransfers,
  type CourseRef,
  type TransferState,
} from "./library";

/** True when this device stores courses on a server that supports it. */
export function useCourseStorage(): boolean {
  useSyncStatus();
  const [supported, setSupported] = useState(false);
  const on = syncEngine.enabled && syncEngine.courseSettings.enabled;
  useEffect(() => {
    if (!on) return setSupported(false);
    let live = true;
    syncEngine
      .courseStorage()
      .then((value) => live && setSupported(value !== null))
      .catch(() => live && setSupported(false));
    return () => {
      live = false;
    };
  }, [on]);
  return on && supported;
}

/** Server status and actions for a course on this device, for the Settings list. */
export function ServerCopyActions({ course }: { course: CourseRef }) {
  const enabled = useCourseStorage();
  const transfer = useTransfers().get(course.id);
  const doc = useProgress();
  const stored = storedCourses(doc)[course.id];
  if (!enabled) return null;

  if (transfer) return <TransferStatus transfer={transfer} courseId={course.id} />;

  return stored ? (
    <>
      <span className="pill pill--ok">
        <Icon name="check" size={13} /> On server
      </span>
      <button
        className="btn btn--quiet"
        type="button"
        onClick={() => {
          if (confirm(`Remove ${course.title} from the server? It stays on this device and any device that downloaded it.`)) {
            void removeStoredCourse(course.id).catch((error: Error) => alert(error.message));
          }
        }}
      >
        Remove from server
      </button>
    </>
  ) : (
    <button className="btn btn--quiet" type="button" onClick={() => void uploadCourse(course).catch(() => {})}>
      <Icon name="upload" /> Upload to server
    </button>
  );
}

/** Courses stored on the server that this device does not have yet, with Download. */
export function ServerOnlyCourses({ localIds }: { localIds: Set<string> }) {
  const enabled = useCourseStorage();
  const doc = useProgress();
  const transfers = useTransfers();
  if (!enabled) return null;

  const waiting = Object.entries(storedCourses(doc)).filter(([id]) => !localIds.has(id));
  if (waiting.length === 0) return null;

  return (
    <section className="section stack">
      <div className="section__head">
        <h2>On your sync server</h2>
        <span className="muted">Not on this device yet</span>
      </div>
      <ul className="list">
        {waiting.map(([id, entry]) => {
          const transfer = transfers.get(id);
          return (
            <li key={id}>
              <span>
                <strong>{entry.title}</strong>
                <span className="muted">
                  {entry.courseNumber ? ` · ${entry.courseNumber}` : ""} · {formatBytes(entry.bytes)}
                </span>
              </span>
              <span className="row" style={{ gap: "0.5rem" }}>
                {transfer ? (
                  <TransferStatus transfer={transfer} courseId={id} />
                ) : (
                  <button className="btn" type="button" onClick={() => void downloadCourse(id).catch(() => {})}>
                    <Icon name="download" /> Download
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const PHASE: Record<TransferState["phase"], string> = {
  checking: "Checking",
  uploading: "Uploading",
  downloading: "Downloading",
  importing: "Importing",
};

function TransferStatus({ transfer, courseId }: { transfer: TransferState; courseId: string }) {
  if (transfer.error) {
    return (
      <span className="transfer transfer--error" role="alert">
        {transfer.error}
        <button className="btn btn--quiet" type="button" onClick={() => clearTransferError(courseId)}>
          Dismiss
        </button>
      </span>
    );
  }
  const percent = transfer.total > 0 ? Math.round((transfer.done / transfer.total) * 100) : 0;
  return (
    <span className="transfer" role="status">
      <span>
        {PHASE[transfer.phase]} {percent}%
      </span>
      <span className="progressbar transfer__bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

