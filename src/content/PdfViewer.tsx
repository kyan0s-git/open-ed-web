import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { Icon } from "@/ui/icons";
import { loadPdfJs, PDF_SUPPORT, type PdfJs } from "./pdfjs";
import { highlight as highlightText, tokenize } from "@/search/text";

/**
 * A PDF viewer built on pdf.js — the engine inside Firefox's viewer — with only the
 * controls a course reader needs.
 *
 * The browser's built-in viewer would cost nothing, but it cannot be themed, shows a
 * blob URL as the document's title, and behaves differently in every browser. pdf.js
 * renders the same everywhere and sits inside the page like any other content. It is
 * loaded only when a PDF is opened: about 147 KB, plus a worker that is cached after.
 *
 * Pages render lazily as they near the viewport, with a text layer over each so notes
 * can be selected, searched with the browser's find and copied.
 */

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;
/** Render pages this far outside the visible area, so scrolling stays smooth. */
const RENDER_MARGIN = "900px 0px";

interface Props {
  url: string;
  title: string;
  /** Identifies the document for remembering the last page read. */
  storageKey: string;
  downloadName: string;
  sizeLabel?: string;
  /** Open at this page instead of the one last read, e.g. from a search result. */
  initialPage?: number;
  /** Words to highlight in the text, e.g. the search that led here. */
  highlight?: string;
}

export function PdfViewer({ url, title, storageKey, downloadName, sizeLabel, initialPage, highlight }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [pdfjs, setPdfjs] = useState<PdfJs | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [dimmed, setDimmed] = useState(() => readFlag("open-ed-web:pdf-dim"));

  // Load pdf.js and the document.
  useEffect(() => {
    let live = true;
    let task: ReturnType<PdfJs["getDocument"]> | null = null;
    setDoc(null);
    setError(null);

    loadPdfJs()
      .then(async (lib) => {
        if (!live) return;
        task = lib.getDocument({ url, ...PDF_SUPPORT });
        const document = await task.promise;
        const first = await document.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        if (!live) return;
        setPdfjs(lib);
        setBaseSize({ width: viewport.width, height: viewport.height });
        setDoc(document);
      })
      .catch((reason: Error) => live && setError(reason.message || "This PDF could not be opened."));

    return () => {
      live = false;
      void task?.destroy();
    };
  }, [url]);

  // Fit to width: follow the viewer's width as it resizes.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !baseSize || !fit) return;
    const update = () => {
      const available = element.clientWidth - 32;
      setScale(clamp(available / baseSize.width));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [baseSize, fit]);

  /**
   * Scroll the viewer — and only the viewer. scrollIntoView would also scroll the
   * window, pushing the toolbar out of sight.
   */
  const scrollToPage = (number: number, behavior: ScrollBehavior) => {
    const box = scroller.current;
    const sheet = pageRefs.current[number - 1];
    if (!box || !sheet) return;
    // The scroller is the sheets' offset parent (position: relative), so this is exact.
    box.scrollTo({ top: sheet.offsetTop - 16, behavior });
  };

  // Open at the requested page, or return to the last page read in this document.
  useEffect(() => {
    if (!doc) return;
    const target = initialPage ?? Number(readValue(`open-ed-web:pdf-page:${storageKey}`));
    if (target > 1 && target <= doc.numPages) {
      requestAnimationFrame(() => scrollToPage(target, "instant"));
    }
  }, [doc, storageKey, initialPage]);

  const terms = useMemo(() => (highlight ? tokenize(highlight).filter((t) => t.length > 1) : []), [highlight]);

  // Track which page is in view.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !doc) return;
    const visible = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.page);
          visible.set(index, entry.intersectionRatio);
        }
        let best = page;
        let ratio = -1;
        for (const [index, value] of visible) {
          if (value > ratio) {
            ratio = value;
            best = index;
          }
        }
        if (ratio > 0) {
          setPage(best);
          setPageInput(String(best));
          writeValue(`open-ed-web:pdf-page:${storageKey}`, String(best));
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const element of pageRefs.current) if (element) observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, storageKey]);

  const goTo = useCallback(
    (target: number) => {
      if (!doc) return;
      const clamped = Math.min(doc.numPages, Math.max(1, target));
      scrollToPage(clamped, "smooth");
    },
    [doc],
  );

  const zoom = (factor: number) => {
    setFit(false);
    setScale((current) => clamp(current * factor));
  };

  const toggleDim = () => {
    setDimmed((value) => {
      writeValue("open-ed-web:pdf-dim", value ? "" : "1");
      return !value;
    });
  };

  return (
    <div className="pdf" data-dimmed={dimmed}>
      <div className="pdf__bar" role="toolbar" aria-label={`${title} controls`}>
        <div className="pdf__group">
          <button type="button" className="iconbtn" onClick={() => goTo(page - 1)} disabled={!doc || page <= 1} aria-label="Previous page">
            <Icon name="left" />
          </button>
          <form
            className="pdf__page"
            onSubmit={(event) => {
              event.preventDefault();
              goTo(Number(pageInput));
            }}
          >
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              aria-label="Page number"
              disabled={!doc}
            />
            <span className="muted">/ {doc?.numPages ?? "–"}</span>
          </form>
          <button
            type="button"
            className="iconbtn"
            onClick={() => goTo(page + 1)}
            disabled={!doc || page >= doc.numPages}
            aria-label="Next page"
          >
            <Icon name="right" />
          </button>
        </div>

        <div className="pdf__group">
          <button type="button" className="iconbtn" onClick={() => zoom(1 / ZOOM_STEP)} disabled={!doc} aria-label="Zoom out">
            <Icon name="minus" />
          </button>
          <button
            type="button"
            className="iconbtn pdf__zoom"
            onClick={() => setFit(true)}
            disabled={!doc}
            aria-pressed={fit}
            title="Fit to width"
          >
            {fit ? "Fit" : `${Math.round(scale * 100)}%`}
          </button>
          <button type="button" className="iconbtn" onClick={() => zoom(ZOOM_STEP)} disabled={!doc} aria-label="Zoom in">
            <Icon name="plus" />
          </button>
        </div>

        <div className="pdf__group">
          <button
            type="button"
            className="iconbtn"
            onClick={toggleDim}
            aria-pressed={dimmed}
            title={dimmed ? "Show pages as printed" : "Dim pages for reading in the dark"}
            aria-label="Dim pages"
          >
            <Icon name="moon" />
          </button>
          <a className="iconbtn" href={url} target="_blank" rel="noopener noreferrer" title="Open in a new tab" aria-label="Open in a new tab">
            <Icon name="external" />
          </a>
          <a className="iconbtn" href={url} download={downloadName} title={`Download${sizeLabel ? ` (${sizeLabel})` : ""}`} aria-label="Download">
            <Icon name="download" />
          </a>
        </div>
      </div>

      <div className="pdf__scroller" ref={scroller} tabIndex={0} aria-label={title}>
        {error && (
          <p className="notice notice--error" role="alert">
            {error}{" "}
            <a href={url} download={downloadName}>
              Download it instead
            </a>
            .
          </p>
        )}
        {!doc && !error && <p className="pdf__loading muted">Opening {title}…</p>}
        {doc &&
          pdfjs &&
          baseSize &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage
              key={i}
              pdfjs={pdfjs}
              doc={doc}
              index={i + 1}
              scale={scale}
              placeholder={baseSize}
              root={scroller}
              terms={terms}
              setRef={(element) => {
                pageRefs.current[i] = element;
              }}
            />
          ))}
      </div>
    </div>
  );
}

function PdfPage({
  pdfjs,
  doc,
  index,
  scale,
  placeholder,
  root,
  terms,
  setRef,
}: {
  pdfjs: PdfJs;
  doc: PDFDocumentProxy;
  index: number;
  scale: number;
  placeholder: { width: number; height: number };
  root: React.RefObject<HTMLDivElement | null>;
  terms: string[];
  setRef: (element: HTMLDivElement | null) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState(placeholder);

  // Only pages near the viewport are rendered.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => entry && setNear(entry.isIntersecting), {
      root: root.current,
      rootMargin: RENDER_MARGIN,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let pdfPage: PDFPageProxy | null = null;

    void doc.getPage(index).then(async (loaded) => {
      if (cancelled) return;
      pdfPage = loaded;
      const viewport = loaded.getViewport({ scale });
      setSize({ width: viewport.width / scale, height: viewport.height / scale });

      const target = canvas.current;
      if (!target) return;
      // Render at device resolution so text stays crisp on high-density screens.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const deviceViewport = loaded.getViewport({ scale: scale * ratio });
      target.width = Math.floor(deviceViewport.width);
      target.height = Math.floor(deviceViewport.height);

      renderTask = loaded.render({ canvas: target, viewport: deviceViewport });
      try {
        await renderTask.promise;
      } catch {
        return; // Cancelled by a newer render; nothing to report.
      }
      if (cancelled || !textLayer.current) return;

      textLayer.current.replaceChildren();
      const layer = new pdfjs.TextLayer({
        textContentSource: loaded.streamTextContent(),
        container: textLayer.current,
        viewport,
      });
      await layer.render().catch(() => {});
      if (!cancelled && textLayer.current) markTerms(textLayer.current, terms);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      pdfPage?.cleanup();
    };
  }, [near, doc, index, scale, pdfjs, terms]);

  return (
    <div
      ref={(element) => {
        container.current = element;
        setRef(element);
      }}
      className="pdf__sheet"
      data-page={index}
      style={
        {
          width: `${size.width * scale}px`,
          height: `${size.height * scale}px`,
          "--scale-factor": scale,
          "--user-unit": 1,
          "--total-scale-factor": "calc(var(--scale-factor) * var(--user-unit))",
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
      aria-label={`Page ${index}`}
    >
      {near && <canvas ref={canvas} />}
      {near && <div ref={textLayer} className="textLayer" />}
    </div>
  );
}

/**
 * Wrap matched words in the text layer so they show through the page. The layer's text
 * is transparent and positioned over the canvas, so wrapping part of a run in an inline
 * element keeps its position — the same approach as the browser's own PDF find.
 */
function markTerms(layer: HTMLElement, terms: string[]): void {
  if (terms.length === 0) return;
  for (const span of layer.querySelectorAll<HTMLSpanElement>("span:not(.markedContent)")) {
    if (span.children.length > 0) continue;
    const segments = highlightText(span.textContent ?? "", terms);
    if (!segments.some((segment) => segment.match)) continue;

    span.replaceChildren(
      ...segments.map((segment) => {
        if (!segment.match) return document.createTextNode(segment.text);
        const hit = document.createElement("span");
        hit.className = "pdf-hit";
        hit.textContent = segment.text;
        return hit;
      }),
    );
  }
}

function clamp(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function readValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readFlag(key: string): boolean {
  return readValue(key) === "1";
}

function writeValue(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable; the setting just will not persist.
  }
}
