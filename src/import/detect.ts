import type { Archive } from "./zip";

export type ArchiveFormat =
  /** Modern OCW (Hugo): per-page data.json plus a root content_map.json. */
  | "ocw-hugo-json"
  /** Modern OCW export that shipped only rendered HTML. */
  | "ocw-hugo-html"
  /** Pre-2022 OCW packages, built around an IMS content manifest. */
  | "ocw-legacy-ims"
  | "unknown";

export interface Detection {
  format: ArchiveFormat;
  /** Where the site root sits inside the archive, "" when it is the archive root. */
  base: string;
  reason: string;
}

/**
 * Identify an archive from its central directory alone — no inflation.
 *
 * OCW's Hugo config declares `coursedata` and `contentmap` output formats, so a
 * modern course publishes a `data.json` beside every page and a `content_map.json`
 * at the site root. When those are present we read structured JSON; when they are
 * not we fall back to parsing the rendered HTML.
 */
export function detectFormat(archive: Archive): Detection {
  const base = findSiteRoot(archive);
  const at = (name: string) => `${base}${name}`;

  if (archive.has(at("content_map.json")) && archive.has(at("data.json"))) {
    return {
      format: "ocw-hugo-json",
      base,
      reason: "found content_map.json and a root data.json",
    };
  }

  if (archive.has(at("data.json"))) {
    const pageData = archive.find(
      (p) => p.startsWith(base) && p.endsWith("/data.json"),
    );
    if (pageData.length > 0) {
      return {
        format: "ocw-hugo-json",
        base,
        reason: `found ${pageData.length} page data.json files (no content map)`,
      };
    }
  }

  if (archive.find((p) => p.endsWith("imsmanifest.xml")).length > 0) {
    return {
      format: "ocw-legacy-ims",
      base,
      reason: "found imsmanifest.xml",
    };
  }

  if (archive.has(at("index.html"))) {
    return {
      format: "ocw-hugo-html",
      base,
      reason: "found index.html but no course JSON",
    };
  }

  return { format: "unknown", base, reason: "no index.html or course JSON found" };
}

/**
 * The site root is wherever index.html/data.json sits. Archives that already had a
 * single wrapping folder had it stripped by the reader, but some nest the site one
 * level deeper (e.g. under the course slug), so look one level down too.
 */
function findSiteRoot(archive: Archive): string {
  for (const marker of ["data.json", "index.html"]) {
    if (archive.has(marker)) return "";
  }

  const candidates = archive
    .find((p) => p.endsWith("/data.json") || p.endsWith("/index.html"))
    .map((p) => p.slice(0, p.lastIndexOf("/") + 1))
    // Shallowest wins: the site root is the least nested match.
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));

  return candidates[0] ?? "";
}
