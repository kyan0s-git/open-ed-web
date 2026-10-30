import { useEffect, useRef, useState } from "react";
import type { Course } from "@/content/schema";
import { deleteCourse, listCourses } from "@/storage/db";
import { deleteCourseArchive, estimateStorage } from "@/storage/opfs";
import { releaseCourse } from "@/content/assets";
import { downloadProgress, filePickerSupported, progressStore } from "@/storage/progress-store";
import { useProgress } from "@/mastery/useProgress";
import { setThemePreference, useThemePreference, type ThemePreference } from "@/ui/theme";
import { Icon, type IconName } from "@/ui/icons";
import { formatBytes } from "@/content/ResourceView";
import { evictCourse } from "./useCourse";
import { resetSearch } from "@/search/client";

const THEMES: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "system", label: "System", icon: "system" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

export function SettingsPage() {
  const progress = useProgress();
  const theme = useThemePreference();
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
      setMessage("Progress merged. Where both copies had an entry, the newer one was kept.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const saveToFile = async () => {
    const picker = (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> })
      .showSaveFilePicker;
    try {
      const handle = await picker({
        suggestedName: "progress.json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      await progressStore.bindToFile(handle);
      setMessage("Saved. From now on every change is also written to that file.");
    } catch {
      // The picker was dismissed.
    }
  };

  const remove = async (course: Course) => {
    if (!confirm(`Remove ${course.title}? Your progress for it is kept, so re-importing restores it.`)) return;
    evictCourse(course.id);
    await releaseCourse(course.id);
    await deleteCourse(course.id);
    await deleteCourseArchive(course.id);
    resetSearch();
    refresh();
  };

  const courseCount = Object.keys(progress.courses).length;

  return (
    <div className="page page--narrow">
      <p className="eyebrow">Settings</p>
      <h1>Settings</h1>

      <section className="section stack">
        <h2 style={{ margin: 0 }}>Appearance</h2>
        <div className="segmented" role="group" aria-label="Theme">
          {THEMES.map(({ value, label, icon }) => (
            <button key={value} type="button" aria-pressed={theme === value} onClick={() => setThemePreference(value)}>
              <Icon name={icon} /> {label}
            </button>
          ))}
        </div>
      </section>

      <section className="section stack">
        <h2 style={{ margin: 0 }}>Your progress</h2>
        <p className="muted" style={{ margin: 0 }}>
          Everything you have read and reviewed lives in one <code>progress.json</code> file —{" "}
          {courseCount === 1 ? "1 course" : `${courseCount} courses`} so far. It is plain, readable JSON:
          export it to back it up or move it to another machine, or keep it in a synced folder. There is
          no account and no server.
        </p>

        <div className="row">
          <button className="btn" type="button" onClick={() => downloadProgress(progress)}>
            <Icon name="download" /> Export progress.json
          </button>
          <button className="btn btn--quiet" type="button" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" /> Import and merge
          </button>
          {filePickerSupported() && (
            <button className="btn btn--quiet" type="button" onClick={saveToFile}>
              <Icon name="file" />
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
          <p className="notice notice--ok" role="status">
            {message}
          </p>
        )}
        {progressStore.lastError && (
          <p className="notice notice--error" role="alert">
            Progress is not saving: {progressStore.lastError.message}
          </p>
        )}
      </section>

      <section className="section stack">
        <h2 style={{ margin: 0 }}>Stored courses</h2>
        {storage && (
          <p className="muted" style={{ margin: 0 }}>
            Using {formatBytes(storage.usageBytes)} of about {formatBytes(storage.quotaBytes)} available on
            this device.
          </p>
        )}

        {courses.length === 0 ? (
          <p className="empty">No courses imported.</p>
        ) : (
          <ul className="list">
            {courses.map((course) => (
              <li key={course.id}>
                <span>
                  <strong>{course.title}</strong>
                  <span className="muted"> · {course.courseNumber}</span>
                </span>
                <button className="btn btn--quiet" type="button" onClick={() => void remove(course)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
