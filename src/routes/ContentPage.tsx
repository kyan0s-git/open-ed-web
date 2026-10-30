import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { db } from "@/storage/db";
import type { CourseNode, ExerciseItem, PageContent } from "@/content/schema";
import { Html } from "@/content/Html";
import { ResourceView } from "@/content/ResourceView";
import { sanitizeCourseHtml } from "@/content/sanitize";
import { SelfAssess } from "@/mastery/SelfAssess";
import { Quiz } from "@/mastery/Quiz";
import { markItem, unmarkItem, useCourseProgress } from "@/mastery/useProgress";
import { ancestry, useCourse, type LoadedCourse } from "./useCourse";
import { ReaderLayout } from "./ReaderLayout";
import { Icon } from "@/ui/icons";

export function ContentPage() {
  const { courseId, pageUid } = useParams({ from: "/c/$courseId/p/$pageUid" });
  const { page, q } = useSearch({ from: "/c/$courseId/p/$pageUid" });
  const loaded = useCourse(courseId);

  if (loaded === undefined) return <div className="page" />;
  if (loaded === null || !loaded.byUid.has(pageUid)) {
    return (
      <div className="page page--narrow">
        <h1>Not found</h1>
        <p className="lede">This page is not part of the course, or the course was removed.</p>
        <Link to="/" className="btn btn--quiet">
          Back to the dashboard
        </Link>
      </div>
    );
  }

  return (
    <ReaderLayout loaded={loaded} currentUid={pageUid}>
      {/* Keyed so per-page state (a played video, a quiz in progress) resets on navigation. */}
      <Item key={pageUid} loaded={loaded} uid={pageUid} page={page} highlight={q} />
    </ReaderLayout>
  );
}

function Item({
  loaded,
  uid,
  page,
  highlight,
}: {
  loaded: LoadedCourse;
  uid: string;
  page?: number;
  highlight?: string;
}) {
  const { course } = loaded;
  const node = loaded.byUid.get(uid)!;
  const resource = loaded.resourceByUid.get(uid);
  const skill = loaded.skillByNode.get(uid);
  const progress = useCourseProgress(course.id);
  const done = progress?.items[uid]?.status === "done";

  const [content, setContent] = useState<PageContent | null | undefined>(undefined);
  const [exercises, setExercises] = useState<ExerciseItem[]>([]);

  useEffect(() => {
    let live = true;
    void Promise.all([
      resource ? undefined : db.pages.get(uid),
      db.exercises.where("courseId").equals(course.id).toArray(),
    ]).then(([page, all]) => {
      if (!live) return;
      setContent(page ?? null);
      setExercises(all.filter((item) => item.id.startsWith(`${uid}:`)));
    });
    return () => {
      live = false;
    };
  }, [course.id, uid, resource]);

  // Opening something counts as started; finishing is the learner's call.
  useEffect(() => {
    void markItem(course.id, course.title, uid, "in_progress");
  }, [course.id, course.title, uid]);

  useEffect(() => {
    document.title = `${node.title} · ${course.title}`;
  }, [node.title, course.title]);

  const crumbs = ancestry(loaded, uid);
  const unlinkedMaterials = materialsNotLinked(loaded, uid, content?.html ?? "");

  return (
    <article>
      <ol className="crumbs" aria-label="Breadcrumb">
        <li>
          <Link to="/c/$courseId" params={{ courseId: course.id }}>
            {course.courseNumber ?? course.title}
          </Link>
        </li>
        {crumbs.map((crumb) => (
          <li key={crumb.uid}>
            <Link to="/c/$courseId/p/$pageUid" params={{ courseId: course.id, pageUid: crumb.uid }}>
              {crumb.title}
            </Link>
          </li>
        ))}
      </ol>

      <div className="titlebar">
        <div>
          {skill && <p className="eyebrow">{skill.kind}</p>}
          <h1>{node.title}</h1>
        </div>
        <button
          type="button"
          className={done ? "btn btn--done" : "btn btn--quiet"}
          aria-pressed={done}
          onClick={() =>
            void (done ? unmarkItem(course.id, course.title, uid) : markItem(course.id, course.title, uid, "done"))
          }
        >
          <Icon name="check" /> {done ? "Finished" : "Mark finished"}
        </button>
      </div>

      {resource && <ResourceView courseId={course.id} resource={resource} page={page} highlight={highlight} />}

      {resource?.descriptionHtml && !/^<p>This resource contains information/i.test(resource.descriptionHtml) && (
        <div
          className="prose muted"
          style={{ marginTop: "1rem" }}
          dangerouslySetInnerHTML={{ __html: sanitizeCourseHtml(resource.descriptionHtml) }}
        />
      )}

      {content && content.html.trim() && (
        <Html html={content.html} courseId={course.id} pageDir={node.path} maps={loaded.maps} highlight={highlight} />
      )}

      {unlinkedMaterials.length > 0 && (
        <section className="related">
          <h2>Materials</h2>
          <ul className="outline">
            {unlinkedMaterials.map((material) => (
              <li key={material.uid}>
                <Link to="/c/$courseId/p/$pageUid" params={{ courseId: course.id, pageUid: material.uid }}>
                  <Icon name={loaded.resourceByUid.get(material.uid)?.youtubeId ? "play" : "file"} />
                  <span>{material.title}</span>
                  <span />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {exercises.length > 0 && (
        <section className="card assess">
          <h2>Check yourself</h2>
          <Quiz courseId={course.id} courseTitle={course.title} skillId={skill?.id ?? `${course.id}:${uid}`} items={exercises} />
        </section>
      )}

      {skill && exercises.length === 0 && (
        <SelfAssess
          courseId={course.id}
          courseTitle={course.title}
          skillId={skill.id}
          current={progress?.skills[skill.id]}
          onRated={() => void markItem(course.id, course.title, uid, "done")}
          prompt={resource?.youtubeId ? "How well did you follow this lecture?" : "How well do you know this?"}
        />
      )}

      <Pager loaded={loaded} uid={uid} />
    </article>
  );
}

/**
 * Materials that sit under this page but that its text does not link to. OCW pages
 * usually list their materials in a table already; repeating those would show
 * everything twice.
 */
function materialsNotLinked(loaded: LoadedCourse, uid: string, html: string): CourseNode[] {
  const children = (loaded.childrenOf.get(uid) ?? []).filter((n) => n.kind === "resource");
  if (children.length === 0) return [];
  // Linked or shown inline (an image in the page counts) by its page or file name.
  return children.filter((child) => {
    const file = loaded.resourceByUid.get(child.uid)?.zipPath;
    const names = [child.path.slice(child.path.lastIndexOf("/") + 1), file ? file.slice(file.lastIndexOf("/") + 1) : ""];
    return !names.some((name) => name && html.includes(name));
  });
}

/**
 * " · Video", " · PDF" for a material, so a lecture's video is told apart from the
 * session page of the same name.
 */
function kindLabel(loaded: LoadedCourse, node: CourseNode): string {
  const resource = loaded.resourceByUid.get(node.uid);
  if (!resource) return "";
  if (resource.youtubeId) return " · Video";
  if (resource.mime === "application/pdf" || /\.pdf$/i.test(resource.zipPath ?? "")) return " · PDF";
  return "";
}

/** Previous and next in study order, with n / p as keyboard shortcuts. */
function Pager({ loaded, uid }: { loaded: LoadedCourse; uid: string }) {
  const navigate = useNavigate();
  const { course } = loaded;
  const index = course.sequence.indexOf(uid);
  const prev = index > 0 ? loaded.byUid.get(course.sequence[index - 1]!) : undefined;
  const next = index >= 0 ? loaded.byUid.get(course.sequence[index + 1]!) : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;

      const go = event.key === "n" ? next : event.key === "p" ? prev : undefined;
      if (!go) return;
      event.preventDefault();
      void navigate({ to: "/c/$courseId/p/$pageUid", params: { courseId: course.id, pageUid: go.uid } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, navigate, course.id]);

  if (!prev && !next) return null;

  return (
    <>
      <nav className="pager" aria-label="Previous and next">
        {prev && (
          <Link to="/c/$courseId/p/$pageUid" params={{ courseId: course.id, pageUid: prev.uid }} rel="prev">
            <span className="pager__dir">
              <Icon name="left" size={14} /> Previous{kindLabel(loaded, prev)}
            </span>
            <span className="pager__title">{prev.title}</span>
          </Link>
        )}
        {next && (
          <Link
            to="/c/$courseId/p/$pageUid"
            params={{ courseId: course.id, pageUid: next.uid }}
            className="pager__next"
            rel="next"
          >
            <span className="pager__dir">
              Next{kindLabel(loaded, next)} <Icon name="right" size={14} />
            </span>
            <span className="pager__title">{next.title}</span>
          </Link>
        )}
      </nav>
      <p className="kbd-hint">
        <kbd>p</kbd> previous · <kbd>n</kbd> next
      </p>
    </>
  );
}
