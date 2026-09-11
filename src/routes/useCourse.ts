import { useEffect, useState } from "react";
import type { Course, CourseNode, Resource } from "@/content/schema";
import { loadCourseOutline } from "@/storage/db";
import { buildCourseMaps, type CourseMaps } from "@/content/maps";

export interface LoadedCourse {
  course: Course;
  nodes: CourseNode[];
  resources: Resource[];
  maps: CourseMaps;
  /** Children indexed by parent uid, in sidebar order. */
  childrenOf: Map<string | null, CourseNode[]>;
}

/** Load a course outline once and derive the structures every reader screen needs. */
export function useCourse(courseId: string): LoadedCourse | null | undefined {
  const [state, setState] = useState<LoadedCourse | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setState(undefined);

    void loadCourseOutline(courseId).then((loaded) => {
      if (!live) return;
      if (!loaded) {
        setState(null);
        return;
      }

      const childrenOf = new Map<string | null, CourseNode[]>();
      for (const node of loaded.nodes) {
        const siblings = childrenOf.get(node.parentUid) ?? [];
        siblings.push(node);
        childrenOf.set(node.parentUid, siblings);
      }
      for (const siblings of childrenOf.values()) {
        siblings.sort((a, b) => a.order - b.order);
      }

      setState({
        ...loaded,
        childrenOf,
        maps: buildCourseMaps(loaded.nodes, loaded.resources),
      });
    });

    return () => {
      live = false;
    };
  }, [courseId]);

  return state;
}
