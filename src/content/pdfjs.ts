/**
 * Loading pdf.js, shared by the viewer and the search indexer.
 *
 * The legacy build, deliberately. pdf.js's default build targets only the newest
 * browsers — it calls Map.prototype.getOrInsertComputed, which many current browsers
 * do not have yet — and the legacy build is the same code with those polyfilled, in
 * the worker as well. About 19 KB more, for a viewer that opens everywhere.
 */

export type PdfJs = typeof import("pdfjs-dist");

let loading: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  loading ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfJs>,
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return loading;
}

const VENDOR = `${import.meta.env.BASE_URL}vendor/pdfjs`;

/** Every support file comes from this site, so PDFs open — and index — offline. */
export const PDF_SUPPORT = {
  standardFontDataUrl: `${VENDOR}/standard_fonts/`,
  cMapUrl: `${VENDOR}/cmaps/`,
  cMapPacked: true,
  iccUrl: `${VENDOR}/iccs/`,
  wasmUrl: `${VENDOR}/wasm/`,
} as const;
