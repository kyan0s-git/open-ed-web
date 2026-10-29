/**
 * Paths inside a published course site.
 *
 * Course HTML links pages in three styles, and all three appear in real archives:
 * relative to the page ("../../resources/lecture-1/index.html"), relative to the site
 * root ("./static_resources/notes.pdf"), and absolute to the live site
 * ("/courses/8-04-quantum-physics-i-spring-2016/notes.pdf"). Everything is reduced to
 * one canonical form — no leading slash, no course prefix, no trailing "index.html" —
 * so a link can be matched against the path a page was stored under.
 */

const ORIGIN = "https://course.invalid/";

/** Canonical form of a site path. "" is the course home. */
export function canonicalPath(path: string): string {
  let out = path.split(/[?#]/)[0] ?? "";
  try {
    out = decodeURIComponent(out);
  } catch {
    // Leave malformed escapes as they are rather than failing the whole page.
  }

  out = out.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  // Absolute links to the live site carry the course's own prefix.
  out = out.replace(/^courses\/[^/]+\//, "").replace(/^courses\/[^/]+$/, "");
  out = out.replace(/(^|\/)(index\.html?|data\.json)$/, "");
  return out.replace(/\/+$/, "");
}

/**
 * Resolve a link found on the page at `pageDir` to a canonical site path, or null when
 * it leaves the course (another site, an email address, an in-page anchor).
 */
export function resolveHref(href: string, pageDir: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return null;

  // Absolute paths are relative to the site, not the page.
  if (trimmed.startsWith("/")) return canonicalPath(trimmed);

  const base = pageDir ? `${ORIGIN}${canonicalPath(pageDir)}/` : ORIGIN;
  try {
    return canonicalPath(new URL(trimmed, base).pathname);
  } catch {
    return null;
  }
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
