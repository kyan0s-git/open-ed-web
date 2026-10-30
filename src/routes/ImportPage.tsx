import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { UnsupportedArchiveError, type ImportProgress } from "@/import/pipeline";
import { runImport } from "@/import/run-import";
import { evictCourse } from "./useCourse";
import { resetSearch } from "@/search/client";
import type { CourseBundle } from "@/content/schema";
import { Icon } from "@/ui/icons";

type Phase =
  | { kind: "idle" }
  | { kind: "working"; progress: ImportProgress }
  | { kind: "failed"; message: string; detail?: string }
  | { kind: "done"; bundle: CourseBundle };

export function ImportPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const start = useCallback(
    async (file: File) => {
      setPhase({ kind: "working", progress: { step: "Reading archive", done: 0, total: 1 } });

      try {
        const bundle = await runImport(file, (progress) =>
          setPhase({ kind: "working", progress }),
        );
        // A re-import replaces the course; drop anything cached from the old copy.
        evictCourse(bundle.course.id);
        resetSearch();
        // Read the course's PDFs into search in the background; it is usable meanwhile.
        void import("@/search/pdf-indexer").then(({ indexPdfText }) => indexPdfText());

        // Go straight to the course when there is nothing worth reporting.
        if (bundle.warnings.length === 0) {
          await navigate({ to: "/c/$courseId", params: { courseId: bundle.course.id } });
          return;
        }
        setPhase({ kind: "done", bundle });
      } catch (error) {
        setPhase({
          kind: "failed",
          message:
            error instanceof UnsupportedArchiveError
              ? "That archive isn't one this can read yet"
              : "The import failed",
          detail: (error as Error).message,
        });
      }
    },
    [navigate],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void start(file);
  };

  return (
    <div className="page page--narrow">
      <p className="eyebrow">Import</p>
      <h1>Add a course</h1>
      <p className="lede">
        On any course at ocw.mit.edu, choose <em>Download course</em>, then drop the <code>.zip</code>{" "}
        here. It is stored on this machine and never uploaded. Videos are not in OCW archives, but
        lectures still play: the archive carries each video’s YouTube id.
      </p>

      {phase.kind === "working" ? (
        <Working progress={phase.progress} />
      ) : (
        <div
          className="dropzone"
          data-over={dragging}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <button className="btn" type="button" onClick={() => inputRef.current?.click()}>
            <Icon name="upload" /> Choose a .zip
          </button>
          <p className="dropzone__hint">or drag one here. Re-importing a course updates it and keeps your progress.</p>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void start(file);
            }}
          />
        </div>
      )}

      {phase.kind === "failed" && (
        <div className="notice notice--error section" role="alert">
          <h2>{phase.message}</h2>
          <p style={{ margin: 0 }}>{phase.detail}</p>
        </div>
      )}

      {phase.kind === "done" && <Summary bundle={phase.bundle} />}
    </div>
  );
}

function Working({ progress }: { progress: ImportProgress }) {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="dropzone" aria-live="polite">
      <p style={{ margin: 0, fontWeight: 600 }}>{progress.step}…</p>
      <div className="progressbar">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Imports that dropped something say so, rather than failing quietly. */
function Summary({ bundle }: { bundle: CourseBundle }) {
  return (
    <div className="notice section">
      <h2>Imported {bundle.course.title}</h2>
      <p style={{ margin: 0 }}>
        {bundle.nodes.length} items, {bundle.skills.length} skills, {bundle.exercises.length}{" "}
        questions. Some things needed attention:
      </p>
      <p style={{ margin: "0.6rem 0" }}>
        <Link to="/c/$courseId" params={{ courseId: bundle.course.id }} className="btn">
          Open the course
        </Link>
      </p>
      <ul>
        {bundle.warnings.slice(0, 8).map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
        {bundle.warnings.length > 8 && <li>…and {bundle.warnings.length - 8} more.</li>}
      </ul>
    </div>
  );
}
