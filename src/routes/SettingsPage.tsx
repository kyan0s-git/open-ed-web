import { useEffect, useRef, useState } from "react";
import type { Course } from "@/content/schema";
import { deleteCourse, listCourses } from "@/storage/db";
import { deleteCourseArchive, estimateStorage } from "@/storage/opfs";
import { releaseCourse } from "@/content/assets";
import {
  downloadProgress,
  filePickerSupported,
  progressStore,
} from "@/storage/progress-store";
import { useProgress } from "@/mastery/useProgress";

/** Where the progress file lives, and how to get it in and out. */
export function SettingsPage() {
  const progress = useProgress();
  const [courses, setCourses] = useState<Course[]>([]);
  const [storage, setStorage] = useState<{ usageBytes: number; quotaBytes: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void listCourses().then(setCourses);
    void estimateStorage().then(setStorage);
  };

  useEffect(refresh, []);

  const importFile = async (file: File) => {
    try {
      await progressStore.importFrom(await file.text());
      setMessage("Progress merged. Newer entries on either side were kept.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const saveToFile = async () => {
    const picker = (
      window as unknown as {
        showSaveFilePicker: (options: unknown) => Promise<FileSystemFileHandle>;
      }
    ).showSaveFilePicker;

    try {
      const handle = await picker({
        suggestedName: "progress.json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      await progressStore.bindToFile(handle);
      setMessage("Saved. Future changes write to that file automatically.");
    } catch {
      // The user dismissed the picker; nothing to report.
    }
  };

  const remove = async (course: Course) => {
    if (!confirm(`Remove ${course.title}? Your progress for it is kept.`)) return;
    await releaseCourse(course.id);
    await deleteCourse(course.id);
    await deleteCourseArchive(course.id);
    refresh();
  };

  const courseCount = Object.keys(progress.courses).length;

  return (
    <div className="page">
      <h1>Settings</h1>

      <section className="stack" style={{ marginBottom: "3rem" }}>
        <h2>Your progress</h2>
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          Everything you have read and reviewed lives in one <code>progress.json</code> file —
          {" "}
          {courseCount === 1 ? "1 course" : `${courseCount} courses`} so far. It is plain,
          readable JSON. Export it to back it up, move it to another machine, or keep it in a
          synced folder.
        </p>

        <div className="row">
          <button className="btn" type="button" onClick={() => downloadProgress(progress)}>
            Export progress.json
          </button>
          <button
            className="btn btn--quiet"
            type="button"
            onClick={() => fileInput.current?.click()}
          >
            Import and merge
          </button>
          {filePickerSupported() && (
            <button className="btn btn--quiet" type="button" onClick={saveToFile}>
              {progressStore.boundToFile ? "Change saved location" : "Keep it in a file I choose"}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
        </div>

        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {progressStore.lastError && (
          <p className="notice notice--error" role="alert">
            Progress is not saving: {progressStore.lastError.message}
          </p>
        )}
      </section>

      <section className="stack">
        <h2>Stored courses</h2>
        {storage && (
          <p style={{ margin: 0, color: "var(--ink-muted)" }}>
            Using {formatBytes(storage.usageBytes)} of roughly{" "}
            {formatBytes(storage.quotaBytes)} available on this device.
          </p>
        )}

        {courses.length === 0 ? (
          <p className="empty">No courses imported.</p>
        ) : (
          <ul className="library">
            {courses.map((course) => (
              <li key={course.id}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                    padding: "0.85rem 0.25rem",
                  }}
                >
                  <span>{course.title}</span>
                  <button className="btn btn--quiet" type="button" onClick={() => remove(course)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
