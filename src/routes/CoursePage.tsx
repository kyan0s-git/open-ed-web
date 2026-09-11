import { Link, useParams } from "@tanstack/react-router";
import { useCourse } from "./useCourse";
import { CourseNav } from "./CourseNav";
import { Html } from "@/content/Html";
import { Mastery } from "@/ui/Mastery";
import { useCourseProgress } from "@/mastery/useProgress";
import { courseMastery, type MasteryLevel } from "@/mastery/levels";

export function CoursePage() {
  const { courseId } = useParams({ from: "/c/$courseId" });
  const loaded = useCourse(courseId);
  const progress = useCourseProgress(courseId);

  if (loaded === undefined) return <div className="page" />;
  if (loaded === null) {
    return (
      <div className="page">
        <h1>Course not found</h1>
        <p className="lede">It may have been removed. Import the archive again to restore it.</p>
        <Link to="/import" className="btn">
          Import a course
        </Link>
      </div>
    );
  }

  const { course } = loaded;
  const levels = Object.values(progress?.skills ?? {}).map((s) => s.level as MasteryLevel);
  const first = (loaded.childrenOf.get(null) ?? []).find((node) => node.kind !== "resource");

  return (
    <div className="reader">
      <CourseNav loaded={loaded} />
      <div className="page">
        <h1>{course.title}</h1>
        <p className="lede">
          {[
            course.courseNumber,
            [course.term, course.year].filter(Boolean).join(" "),
            course.level.join(", "),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <div className="row" style={{ marginBottom: "2rem" }}>
          {first && (
            <Link
              to="/c/$courseId/p/$pageUid"
              params={{ courseId, pageUid: first.uid }}
              className="btn"
            >
              Start reading
            </Link>
          )}
          <Mastery percent={courseMastery(levels)} />
        </div>

        {course.descriptionHtml && (
          <Html
            html={course.descriptionHtml}
            courseId={courseId}
            pathToUid={loaded.maps.pathToUid}
            assetPaths={loaded.maps.assetPaths}
          />
        )}

        {course.instructors.length > 0 && (
          <p className="lede" style={{ marginTop: "2rem" }}>
            Taught by {course.instructors.map((person) => person.name).join(", ")}.
          </p>
        )}

        {course.topics.length > 0 && (
          <p className="lede">Topics: {course.topics.join(", ")}.</p>
        )}

        <Attribution
          title={course.title}
          license={course.license}
          instructors={course.instructors.map((person) => person.name)}
        />
      </div>
    </div>
  );
}

/**
 * OCW material is licensed CC BY-NC-SA, which requires attribution. Nothing is
 * re-hosted here — the archive stays on this machine — but the reader still shows whose
 * work it is and under what terms.
 */
function Attribution({
  title,
  license,
  instructors,
}: {
  title: string;
  license?: string;
  instructors: string[];
}) {
  return (
    <footer className="notice" style={{ marginTop: "3rem" }}>
      <h2>Source and licence</h2>
      <p style={{ margin: 0 }}>
        {title}
        {instructors.length > 0 && <> by {instructors.join(", ")}</>}, from{" "}
        <a href="https://ocw.mit.edu" target="_blank" rel="noopener noreferrer">
          MIT OpenCourseWare
        </a>
        .{" "}
        {license ? (
          <a href={license} target="_blank" rel="noopener noreferrer">
            Licence
          </a>
        ) : (
          "Licensed CC BY-NC-SA."
        )}{" "}
        This reader is not affiliated with MIT.
      </p>
    </footer>
  );
}
