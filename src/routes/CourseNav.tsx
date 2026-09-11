import { Link } from "@tanstack/react-router";
import type { CourseNode } from "@/content/schema";
import type { LoadedCourse } from "./useCourse";
import { useCourseProgress } from "@/mastery/useProgress";

/** The course sidebar, in the order and nesting the archive's own navigation had. */
export function CourseNav({
  loaded,
  currentUid,
}: {
  loaded: LoadedCourse;
  currentUid?: string;
}) {
  const progress = useCourseProgress(loaded.course.id);

  const renderLevel = (parentUid: string | null) => {
    const children = loaded.childrenOf.get(parentUid) ?? [];
    const visible = children.filter((node) => node.kind !== "resource");
    if (visible.length === 0) return null;

    return (
      <ul>
        {visible.map((node) => (
          <li key={node.uid}>
            <NavLink
              node={node}
              courseId={loaded.course.id}
              current={node.uid === currentUid}
              done={progress?.items[node.uid]?.status === "done"}
            />
            {renderLevel(node.uid)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <nav className="coursenav" aria-label="Course contents">
      <Link
        to="/c/$courseId"
        params={{ courseId: loaded.course.id }}
        className="coursenav__course"
      >
        {loaded.course.title}
      </Link>
      {renderLevel(null)}
    </nav>
  );
}

function NavLink({
  node,
  courseId,
  current,
  done,
}: {
  node: CourseNode;
  courseId: string;
  current: boolean;
  done: boolean;
}) {
  return (
    <Link
      to="/c/$courseId/p/$pageUid"
      params={{ courseId, pageUid: node.uid }}
      data-current={current}
      data-done={done}
    >
      {node.title}
    </Link>
  );
}
