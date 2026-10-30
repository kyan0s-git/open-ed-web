import type { CourseNode, Resource } from "./schema";
import { basename, canonicalPath } from "./paths";

export interface AssetRef {
  zipPath: string;
  mime?: string;
}

export interface CourseMaps {
  pathToUid: Map<string, string>;
  assetPaths: Map<string, AssetRef>;
}

/**
 * Lookup tables for rewriting links inside course HTML.
 *
 * Assets are keyed by path *and* by filename. Archives move files — a PDF published at
 * the course root ships in static_resources — so a link written against the live site
 * often will not match the path inside the archive, while the filename still does.
 */
export function buildCourseMaps(nodes: CourseNode[], resources: Resource[]): CourseMaps {
  const pathToUid = new Map<string, string>();
  for (const node of nodes) pathToUid.set(canonicalPath(node.path), node.uid);

  const assetPaths = new Map<string, AssetRef>();
  for (const resource of resources) {
    if (!resource.zipPath) continue;
    const ref = { zipPath: resource.zipPath, mime: resource.mime };
    assetPaths.set(canonicalPath(resource.zipPath), ref);
    assetPaths.set(basename(resource.zipPath), ref);
  }

  return { pathToUid, assetPaths };
}

/** Find an archive file for a canonical site path, falling back to its filename. */
export function lookupAsset(assetPaths: Map<string, AssetRef>, path: string): AssetRef | undefined {
  return assetPaths.get(path) ?? assetPaths.get(basename(path));
}

/** Files referenced from course HTML that are not resources, e.g. inline images. */
export function guessMime(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      webp: "image/webp",
      pdf: "application/pdf",
    } as Record<string, string>
  )[ext];
}
