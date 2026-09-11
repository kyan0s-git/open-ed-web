import DOMPurify from "dompurify";

/**
 * Course HTML is untrusted: it comes from a file the user dropped in, and an archive
 * could carry anything. Everything imported goes through here before reaching the DOM.
 */
export function sanitizeCourseHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target"],
    USE_PROFILES: { html: true, svg: true, mathMl: true },
  });
}
