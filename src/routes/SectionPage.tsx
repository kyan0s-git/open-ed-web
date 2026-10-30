import { Link, useParams } from "@tanstack/react-router";
import { useCourse } from "./useCourse";
import { ReaderLayout } from "./ReaderLayout";
import { useCourseProgress } from "@/mastery/useProgress";
import type { Section } from "@/content/sections";
import { Icon } from "@/ui/icons";

/**
 * One standard section of a course: everything of one kind (the lecture notes, the
 * exams...), in study order, with solutions beside what they solve. The same screen for
 * every course, so things are where the learner expects them.
 */
export function SectionPage() {
  const { courseId, section: sectionId } = useParams({ from: "/c/$courseId/s/$section" });
  const loaded = useCourse(courseId);
  const progress = useCourseProgress(courseId);

  if (loaded === undefined) return <div className="page" />;
  if (loaded === null) {
    return (
      <div className="page page--narrow">
        <h1>Course not found</h1>
        <Link to="/courses">Your courses</Link>
      </div>
    );
  }

  const section = loaded.sections.find((s) => s.def.id === sectionId);
  const { course } = loaded;

  return (
    <ReaderLayout loaded={loaded}>
      <ol className="crumbs" aria-label="Breadcrumb">
        <li>
          <Link to="/c/$courseId" params={{ courseId }}>
            {course.courseNumber ?? course.title}
          </Link>
        </li>
      </ol>

      {!section ? (
        <>
          <h1>Nothing here</h1>
          <p className="lede">This course has no materials of this kind.</p>
        </>
      ) : (
        <>
          <div className="titlebar">
            <div>
              <p className="eyebrow">{course.title}</p>
              <h1>{section.def.label}</h1>
            </div>
          </div>
          <SectionBody section={section} courseId={courseId} done={(uid) => progress?.items[uid]?.status === "done"} />
        </>
      )}
    </ReaderLayout>
  );
}

function SectionBody({ section, courseId, done }: { section: Section; courseId: string; done: (uid: string) => boolean }) {
  return (
    <div className="stack">
      {section.page && (
        <Link to="/c/$courseId/p/$pageUid" params={{ courseId, pageUid: section.page.uid }} className="card card--pad sectionpage">
          <Icon name="file" />
          <span>
            <strong>The course's {section.page.title} page</strong>
            <span className="muted"> · as the instructors wrote it</span>
          </span>
          <Icon name="right" />
        </Link>
      )}

      {section.items.length > 0 && (
        <ol className="sectionlist">
          {section.items.map((item) => (
            <li key={item.node.uid}>
              <span className="outline__state" data-done={done(item.node.uid)}>
                {done(item.node.uid) && <Icon name="check" size={13} label="Finished" />}
              </span>
              <Link to="/c/$courseId/p/$pageUid" params={{ courseId, pageUid: item.node.uid }} className="sectionlist__title">
                {item.title}
              </Link>
              <span className="pill">{item.format}</span>
              {item.solution && (
                <Link
                  to="/c/$courseId/p/$pageUid"
                  params={{ courseId, pageUid: item.solution.node.uid }}
                  className="pill pill--ok sectionlist__solution"
                  title={item.solution.title}
                >
                  Solutions
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
