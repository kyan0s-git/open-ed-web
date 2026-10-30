import { useEffect, useState } from "react";
import type { Course, CourseNode, Resource, Skill } from "@/content/schema";
import { db, loadCourseOutline } from "@/storage/db";
import { buildCourseMaps, type CourseMaps } from "@/content/maps";

export interface LoadedCourse {
  course: Course;
  nodes: CourseNode[];
  resources: Resource[];
  skills: Skill[];
  maps: CourseMaps;
  byUid: Map<string, CourseNode>;
  resourceByUid: Map<string, Resource>;
  skillByNode: Map<string, Skill>;
  /** Children indexed by parent uid, in sidebar order. */
  childrenOf: Map<string | null, CourseNode[]>;
}

const cache = new Map<string, LoadedCourse>();

/**
 * Load a course outline once and derive what every reader screen needs. Kept in memory
 * so moving between pages of the same course does not reload it.
 */
export function useCourse(courseId: string): LoadedCourse | null | undefined {
  const [state, setState] = useState<LoadedCourse | null | undefined>(() => cache.get(courseId));

  useEffect(() => {
    const cached = cache.get(courseId);
    if (cached) {
      setState(cached);
      return;
    }

    let live = true;
    setState(undefined);

    void Promise.all([
      loadCourseOutline(courseId),
      db.skills.where("courseId").equals(courseId).sortBy("order"),
    ]).then(([loaded, skills]) => {
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
      for (const siblings of childrenOf.values()) siblings.sort((a, b) => a.order - b.order);

      const result: LoadedCourse = {
        ...loaded,
        skills,
        childrenOf,
        maps: buildCourseMaps(loaded.nodes, loaded.resources),
        byUid: new Map(loaded.nodes.map((n) => [n.uid, n])),
        resourceByUid: new Map(loaded.resources.map((r) => [r.uid, r])),
        skillByNode: new Map(skills.map((s) => [s.nodeUid, s])),
      };
      cache.set(courseId, result);
      setState(result);
    });

    return () => {
      live = false;
    };
  }, [courseId]);

  return state;
}

/** Forget a course, e.g. after it is removed or re-imported. */
export function evictCourse(courseId: string): void {
  cache.delete(courseId);
}

/** Path from the top of the course down to a node, for breadcrumbs. */
export function ancestry(loaded: LoadedCourse, uid: string): CourseNode[] {
  const chain: CourseNode[] = [];
  let current = loaded.byUid.get(uid);
  const seen = new Set<string>();
  while (current?.parentUid && !seen.has(current.parentUid)) {
    seen.add(current.parentUid);
    const parent = loaded.byUid.get(current.parentUid);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}
