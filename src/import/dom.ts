/**
 * HTML parsing that works on the main thread and in a worker.
 *
 * DOMParser is a Window API — workers do not have it — and the import deliberately runs
 * in a worker so a large course does not freeze the UI. So the parsers go through this
 * indirection: the browser's own parser where it exists, and linkedom in the worker,
 * where it is loaded lazily and therefore never reaches the initial payload.
 */

type ParseFn = (html: string) => Document;

let parse: ParseFn | null = null;

const nativeParser = (): ParseFn | null =>
  typeof DOMParser === "undefined"
    ? null
    : (html) => new DOMParser().parseFromString(wrap(html), "text/html");

/** Prepare a parser. Call once before parsing; safe to call repeatedly. */
export async function initDom(): Promise<void> {
  if (parse) return;

  const native = nativeParser();
  if (native) {
    parse = native;
    return;
  }

  const { parseHTML } = await import("linkedom");
  parse = (html) => parseHTML(wrap(html)).document as unknown as Document;
}

export function parseHtmlDocument(html: string): Document {
  parse ??= nativeParser();
  if (!parse) {
    throw new Error("No HTML parser available; call initDom() before parsing.");
  }
  return parse(html);
}

/**
 * Fragments and whole documents both arrive here — page content is a fragment, the
 * course index is a full document. Wrapping fragments guarantees a body either way.
 */
function wrap(html: string): string {
  return /<(!doctype|html|body)\b/i.test(html)
    ? html
    : `<!DOCTYPE html><html><body>${html}</body></html>`;
}
