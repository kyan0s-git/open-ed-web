import { Link } from "@tanstack/react-router";
import type { CourseNode } from "@/content/schema";
import type { LoadedCourse } from "./useCourse";
import { useCourseProgress } from "@/mastery/useProgress";
import { Icon } from "@/ui/icons";

/**
 * The course sidebar, in the order and nesting the archive's own navigation had. Shows
 * pages only — the materials on each page are listed on the page itself, as on OCW.
 */
export function CourseNav({
  loaded,
  currentUid,
  onNavigate,
}: {
  loaded: LoadedCourse;
  currentUid?: string;
  onNavigate?: () => void;
}) {
  const progress = useCourseProgress(loaded.course.id);
  const { course } = loaded;

  // A material's page is the one it sits under, so highlight that while reading it.
  const highlighted = (() => {
    const node = currentUid ? loaded.byUid.get(currentUid) : undefined;
    return node?.kind === "resource" ? node.parentUid : currentUid;
  })();

  const renderLevel = (parentUid: string | null) => {
    const visible = (loaded.childrenOf.get(parentUid) ?? []).filter((n) => n.kind !== "resource");
    if (visible.length === 0) return null;

    return (
      <ul>
        {visible.map((node) => (
          <li key={node.uid}>
            <NavLink
              node={node}
              courseId={course.id}
              current={node.uid === highlighted}
              done={progress?.items[node.uid]?.status === "done"}
              onNavigate={onNavigate}
            />
            {renderLevel(node.uid)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    // One container for the drawer; two landmarks inside, so the standard sections and
    // the course's own pages (which can share names, like "Syllabus") stay distinct.
    <div className="coursenav" id="course-contents">
      <Link to="/c/$courseId" params={{ courseId: course.id }} className="coursenav__course" onClick={onNavigate}>
        <span>{course.courseNumber}</span>
        <strong>{course.title}</strong>
      </Link>
      {loaded.sections.length > 0 && (
        <nav aria-label="Find in this course">
          <p className="coursenav__heading">Find</p>
          <ul className="coursenav__sections">
            {loaded.sections.map((section) => (
              <li key={section.def.id}>
                <Link
                  to="/c/$courseId/s/$section"
                  params={{ courseId: course.id, section: section.def.id }}
                  activeProps={{ "data-current": "true" }}
                  onClick={onNavigate}
                >
                  {section.def.label}
                  {section.items.length > 0 && <span className="coursenav__count">{section.items.length}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <p className="coursenav__heading">Course pages</p>
        </nav>
      )}
      <nav aria-label="Course contents">{renderLevel(null)}</nav>
    </div>
  );
}

function NavLink({
  node,
  courseId,
  current,
  done,
  onNavigate,
}: {
  node: CourseNode;
  courseId: string;
  current: boolean;
  done: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to="/c/$courseId/p/$pageUid"
      params={{ courseId, pageUid: node.uid }}
      data-current={current}
      aria-current={current ? "page" : undefined}
      onClick={onNavigate}
    >
      {node.title}
      {done && (
        <span className="coursenav__tick">
          <Icon name="check" size={14} label="Finished" />
        </span>
      )}
    </Link>
  );
}
