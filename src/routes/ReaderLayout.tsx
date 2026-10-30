import { useEffect, useState, type ReactNode } from "react";
import { CourseNav } from "./CourseNav";
import type { LoadedCourse } from "./useCourse";
import { Icon } from "@/ui/icons";

/**
 * Sidebar beside a reading column. On narrow screens the sidebar becomes a drawer,
 * opened from a "Contents" button and closed by choosing a page, tapping outside, or
 * pressing Escape.
 */
export function ReaderLayout({
  loaded,
  currentUid,
  children,
}: {
  loaded: LoadedCourse;
  currentUid?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [currentUid]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="reader" data-nav-open={open}>
      <CourseNav loaded={loaded} currentUid={currentUid} onNavigate={() => setOpen(false)} />
      {open && <button type="button" className="scrim" aria-label="Close contents" onClick={() => setOpen(false)} />}
      <div className="reader__main">
        <div className="reader__column">
          <button
            type="button"
            className="btn btn--quiet navtoggle"
            aria-expanded={open}
            aria-controls="course-contents"
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? "close" : "menu"} /> Contents
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}
