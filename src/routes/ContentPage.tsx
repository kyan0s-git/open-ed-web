import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { db } from "@/storage/db";
import type { ExerciseItem, PageContent, Resource } from "@/content/schema";
import { Html } from "@/content/Html";
import { ResourceView } from "@/content/ResourceView";
import { SelfAssess } from "@/mastery/SelfAssess";
import { Quiz } from "@/mastery/Quiz";
import { markItem, useCourseProgress } from "@/mastery/useProgress";
import { useCourse } from "./useCourse";
import { CourseNav } from "./CourseNav";

export function ContentPage() {
  const { courseId, pageUid } = useParams({ from: "/c/$courseId/p/$pageUid" });
  const loaded = useCourse(courseId);
  const progress = useCourseProgress(courseId);
  const [content, setContent] = useState<PageContent | null | undefined>(undefined);
  const [exercises, setExercises] = useState<ExerciseItem[]>([]);

  useEffect(() => {
    let live = true;
    setContent(undefined);

    void Promise.all([
      db.pages.get(pageUid),
      db.exercises.where("courseId").equals(courseId).toArray(),
    ]).then(([page, allExercises]) => {
      if (!live) return;
      setContent(page ?? null);
      setExercises(allExercises.filter((item) => item.id.startsWith(`${pageUid}:`)));
    });

    return () => {
      live = false;
    };
  }, [courseId, pageUid]);

  // Opening a page is enough to count as started; finishing is the learner's call.
  useEffect(() => {
    if (loaded && content !== undefined) {
      markItem(courseId, loaded.course.title, pageUid, "in_progress");
    }
  }, [courseId, pageUid, loaded, content]);

  if (!loaded) return <div className="page" />;

  const node = loaded.nodes.find((candidate) => candidate.uid === pageUid);
  const childResources = (loaded.childrenOf.get(pageUid) ?? []).filter(
    (child) => child.kind === "resource",
  );
  const resources = childResources
    .map((child) => loaded.resources.find((resource) => resource.uid === child.uid))
    .filter((resource): resource is Resource => Boolean(resource));

  const asResource = loaded.resources.find((resource) => resource.uid === pageUid);
  const skillId = `${courseId}:${pageUid}`;
  const skill = progress?.skills[skillId];

  return (
    <div className="reader">
      <CourseNav loaded={loaded} currentUid={pageUid} />
      <div className="page">
        <h1>{node?.title ?? "Untitled"}</h1>

        {asResource && <ResourceView courseId={courseId} resource={asResource} />}

        {content && (
          <Html
            html={content.html}
            courseId={courseId}
            pathToUid={loaded.maps.pathToUid}
            assetPaths={loaded.maps.assetPaths}
          />
        )}

        {resources.length > 0 && (
          <section className="resources">
            <h2>Materials</h2>
            <ul>
              {resources.map((resource) => (
                <li key={resource.uid}>
                  <Link
                    to="/c/$courseId/p/$pageUid"
                    params={{ courseId, pageUid: resource.uid }}
                  >
                    <span>{resource.title}</span>
                    <span className="resources__kind">
                      {resource.youtubeId ? "Video" : (resource.mime ?? resource.resourcetype)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {exercises.length > 0 && (
          <section className="resources">
            <h2>Check yourself</h2>
            <Quiz
              courseId={courseId}
              courseTitle={loaded.course.title}
              skillId={skillId}
              items={exercises}
            />
          </section>
        )}

        {content && content.html.trim().length > 0 && exercises.length === 0 && (
          <section className="resources">
            <SelfAssess
              courseId={courseId}
              courseTitle={loaded.course.title}
              skillId={skillId}
              current={skill}
              onRated={() => markItem(courseId, loaded.course.title, pageUid, "done")}
            />
          </section>
        )}
      </div>
    </div>
  );
}
