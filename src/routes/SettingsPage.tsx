import { useEffect, useRef, useState } from "react";
import type { Course } from "@/content/schema";
import { deleteCourse, listCourses } from "@/storage/db";
import { onCoursesChanged } from "@/storage/queries";
import { deleteCourseArchive, estimateStorage } from "@/storage/opfs";
import { releaseCourse } from "@/content/assets";
import { downloadProgress, filePickerSupported, progressStore } from "@/storage/progress-store";
import { useProgress } from "@/mastery/useProgress";
import { setThemePreference, useThemePreference, type ThemePreference } from "@/ui/theme";
import { Icon, type IconName } from "@/ui/icons";
import { formatBytes } from "@/content/ResourceView";
import { evictCourse } from "./useCourse";
import { resetSearch } from "@/search/client";
import { SyncSettings } from "@/sync/SyncSettings";
import { LibrarySettingsPanel } from "@/library/LibraryUI";
import { UpdateSettings } from "@/updates/UpdateUI";
import { readSyncConfig } from "@/sync/config";

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
  useEffect(() => {
    refresh();
    return onCoursesChanged(refresh);
  }, []);

  const importFile = async (file: File) => {
    try {
      const merged = await progressStore.importFrom(await file.text());
      // The file carries the course library too: fetch the courses it lists that this
      // device does not have, so moving to a new device brings the courses along.
      const library = await import("@/library/library");
      const missing = (await library.missingCourses()).length;
      void library.autoDownload();
      const courses = Object.values(merged.library).filter((entry) => !entry.removed).length;
      setMessage(
        `Progress merged; where both copies had an entry, the newer one was kept. Your library has ${courses} ${
          courses === 1 ? "course" : "courses"
        }${missing > 0 ? `, ${missing} not on this device yet. ${library.librarySettings().autoDownload ? "They are downloading now (see Courses)." : "Download them from the Courses page."}` : "."}`,
      );
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

  const remove = async (course: Course, everywhere: boolean) => {
    const question = everywhere
      ? `Remove ${course.title} from your library? It is deleted here, and your other devices stop downloading it (copies already on them stay). Your progress for it is kept.`
      : `Remove ${course.title} from this device? It stays in your library, so you can download it again from the Courses page. Your progress for it is kept.`;
    if (!confirm(question)) return;
    const library = await import("@/library/library");
    if (everywhere) await library.removeFromLibrary(course.id);
    else library.removedOnThisDevice(course.id);
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
          Everything you have read and reviewed, and the list of courses you have, lives in one{" "}
          <code>progress.json</code> file —{" "}
          {courseCount === 1 ? "1 course" : `${courseCount} courses`} so far. It is plain, readable JSON:
          export it to back it up or move it to another machine, keep it in a synced folder, or turn on sync
          below. There is no account.
        </p>

        <div className="row">
          <button className="btn" type="button" onClick={() => void downloadProgress(progress)}>
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

      <SyncSettings />

      <LibrarySettingsPanel syncing={readSyncConfig() !== null} />

      <section className="section stack">
        <h2 style={{ margin: 0 }}>Stored courses</h2>
        {storage && (
          <p className="muted" style={{ margin: 0 }}>
            Using {formatBytes(storage.usageBytes)} of about {formatBytes(storage.quotaBytes)} available on
            this device. Each course is a copy of its .zip, so you can delete the original download.
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
                <span className="row" style={{ gap: "0.5rem" }}>
                  <button className="btn btn--quiet" type="button" onClick={() => void remove(course, false)}>
                    Remove from this device
                  </button>
                  <button className="btn btn--quiet" type="button" onClick={() => void remove(course, true)}>
                    Remove everywhere
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <UpdateSettings />
    </div>
  );
}
