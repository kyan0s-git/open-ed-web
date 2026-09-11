import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { assetUrl } from "./assets";
import { lookupAsset } from "./maps";
import { sanitizeCourseHtml } from "./sanitize";

/**
 * Renders course HTML.
 *
 * Imported markup is untrusted — it comes from a file the user dropped in — so it is
 * sanitized before it reaches the DOM. After that, two rewrites make it work offline:
 * links between course pages become app navigations, and asset references become blob
 * URLs read out of the stored archive.
 */

export interface HtmlProps {
  html: string;
  courseId: string;
  /** Published path -> content uid, from the archive's content map. */
  pathToUid: Map<string, string>;
  /** Published asset path -> path inside the archive. */
  assetPaths: Map<string, { zipPath: string; mime?: string }>;
}

export function Html({ html, courseId, pathToUid, assetPaths }: HtmlProps) {
  const container = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const clean = useMemo(() => sanitizeCourseHtml(html), [html]);

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    for (const image of root.querySelectorAll("img")) {
      const asset = lookupAsset(assetPaths, image.getAttribute("src") ?? "");
      if (asset) void assetUrl(courseId, asset.zipPath, asset.mime).then((url) => (image.src = url));
      image.loading = "lazy";
    }

    for (const anchor of root.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href") ?? "";
      if (/^(https?:|mailto:|#)/i.test(href)) {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
        continue;
      }

      const path = normalize(href);
      const uid = pathToUid.get(path);
      if (uid) {
        anchor.setAttribute("data-page-uid", uid);
        continue;
      }

      const asset = lookupAsset(assetPaths, path);
      if (asset) {
        void assetUrl(courseId, asset.zipPath, asset.mime).then((url) => {
          anchor.setAttribute("href", url);
          anchor.setAttribute("target", "_blank");
          anchor.setAttribute("rel", "noopener noreferrer");
        });
      }
    }
  }, [clean, courseId, pathToUid, assetPaths]);

  // Internal links navigate in-app rather than reloading, so reader state survives.
  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest?.("a[data-page-uid]");
    const uid = anchor?.getAttribute("data-page-uid");
    if (!uid || event.metaKey || event.ctrlKey || event.shiftKey) return;

    event.preventDefault();
    void navigate({ to: "/c/$courseId/p/$pageUid", params: { courseId, pageUid: uid } });
  };

  return (
    <div
      ref={container}
      className="prose"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

/** Compare paths without leading slashes, query strings or trailing slashes. */
export function normalize(href: string | null): string {
  if (!href) return "";
  const path = href.split(/[?#]/)[0] ?? "";
  return decodeURIComponent(path).replace(/^\//, "").replace(/\/$/, "");
}
