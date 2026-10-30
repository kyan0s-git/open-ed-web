import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { assetUrl } from "./assets";
import { guessMime, lookupAsset, type CourseMaps } from "./maps";
import { resolveHref } from "./paths";
import { sanitizeCourseHtml } from "./sanitize";
import { hasMath, typesetMath } from "./math";
import { highlight as highlightText, tokenize } from "@/search/text";

/**
 * Renders course HTML.
 *
 * Imported markup is untrusted — it comes from a file the user dropped in — so it is
 * sanitized before it reaches the DOM. Then it is made to work offline: links between
 * course pages become app navigations, files become blob URLs read from the stored
 * archive, and math is typeset.
 */

export interface HtmlProps {
  html: string;
  courseId: string;
  /** Where this page lives in the site; relative links resolve from here. */
  pageDir: string;
  maps: CourseMaps;
  className?: string;
  /** Words to highlight, e.g. the search that led to this page. */
  highlight?: string;
}

export function Html({ html, courseId, pageDir, maps, className = "prose", highlight }: HtmlProps) {
  const container = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const clean = useMemo(() => sanitizeCourseHtml(html), [html]);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let live = true;

    for (const image of root.querySelectorAll("img")) {
      image.loading = "lazy";
      image.decoding = "async";
      const path = resolveHref(image.getAttribute("src") ?? "", pageDir);
      const asset = path === null ? undefined : lookupAsset(maps.assetPaths, path);
      if (asset) {
        image.removeAttribute("src");
        void assetUrl(courseId, asset.zipPath, asset.mime ?? guessMime(asset.zipPath)).then(
          (url) => live && (image.src = url),
        );
      }
    }

    for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const href = anchor.getAttribute("href") ?? "";
      const path = resolveHref(href, pageDir);

      if (path === null) {
        if (!href.startsWith("#")) {
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        }
        continue;
      }

      const uid = maps.pathToUid.get(path);
      if (uid) {
        anchor.dataset.pageUid = uid;
        anchor.href = `${import.meta.env.BASE_URL}c/${courseId}/p/${uid}`;
        continue;
      }

      const asset = lookupAsset(maps.assetPaths, path);
      if (asset) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        void assetUrl(courseId, asset.zipPath, asset.mime ?? guessMime(asset.zipPath)).then(
          (url) => live && (anchor.href = url),
        );
      }
    }

    // Wide tables scroll inside their own box instead of widening the page.
    for (const table of root.querySelectorAll("table")) {
      if (table.parentElement?.classList.contains("tablewrap")) continue;
      const wrap = document.createElement("div");
      wrap.className = "tablewrap";
      table.replaceWith(wrap);
      wrap.append(table);
    }

    if (highlight) markText(root, highlight);
    if (hasMath(clean)) void typesetMath(root);

    return () => {
      live = false;
    };
  }, [clean, courseId, pageDir, maps, highlight]);

  // Internal links navigate in-app, so the reader keeps its state.
  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest?.("a[data-page-uid]");
    const uid = anchor?.getAttribute("data-page-uid");
    if (!uid || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void navigate({ to: "/c/$courseId/p/$pageUid", params: { courseId, pageUid: uid } });
  };

  return (
    <div
      ref={container}
      className={className}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

/**
 * Wrap the words a search matched in <mark>, walking text nodes only so markup and
 * links are untouched, and bring the first one into view.
 */
function markText(root: HTMLElement, query: string): void {
  const terms = tokenize(query).filter((term) => term.length > 1);
  if (terms.length === 0) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("mark, script, style, mjx-container") ||
      // TeX not yet typeset: marking inside it would break the formula.
      hasMath((node as Text).data)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });

  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);

  let first: HTMLElement | null = null;
  for (const node of nodes) {
    const segments = highlightText(node.data, terms);
    if (!segments.some((segment) => segment.match)) continue;
    node.replaceWith(
      ...segments.map((segment) => {
        if (!segment.match) return document.createTextNode(segment.text);
        const mark = document.createElement("mark");
        mark.textContent = segment.text;
        first ??= mark;
        return mark;
      }),
    );
  }

  (first as HTMLElement | null)?.scrollIntoView({ block: "center" });
}
