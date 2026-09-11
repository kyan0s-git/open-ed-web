import type { CourseNode, Resource } from "./schema";
import { normalize } from "./Html";

export interface CourseMaps {
  pathToUid: Map<string, string>;
  assetPaths: Map<string, { zipPath: string; mime?: string }>;
}

/**
 * Lookup tables for rewriting links inside course HTML.
 *
 * Assets are keyed by their published path *and* by filename. Exporters move files
 * around (OCW's help pages describe them landing in a `static_resources` folder), so a
 * link written against the live site often will not match the path inside the archive,
 * while the filename still does.
 */
export function buildCourseMaps(nodes: CourseNode[], resources: Resource[]): CourseMaps {
  const pathToUid = new Map<string, string>();
  for (const node of nodes) {
    pathToUid.set(normalize(node.path), node.uid);
  }

  const assetPaths = new Map<string, { zipPath: string; mime?: string }>();
  const byUid = new Map(nodes.map((node) => [node.uid, node]));

  for (const resource of resources) {
    if (!resource.zipPath) continue;
    const value = { zipPath: resource.zipPath, mime: resource.mime };

    assetPaths.set(normalize(resource.zipPath), value);
    assetPaths.set(basename(resource.zipPath), value);

    // A link may point at the resource's own page rather than the file.
    const node = byUid.get(resource.uid);
    if (node) assetPaths.set(normalize(node.path), value);
  }

  return { pathToUid, assetPaths };
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function lookupAsset(
  assetPaths: CourseMaps["assetPaths"],
  href: string,
): { zipPath: string; mime?: string } | undefined {
  const path = normalize(href);
  return assetPaths.get(path) ?? assetPaths.get(basename(path));
}
