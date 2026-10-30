/**
 * Copy the on-demand parts of MathJax and pdf.js into public/, so they are served
 * from this site rather than a CDN.
 *
 * The reader is local-first: a course that works offline should typeset its math and
 * show its PDFs offline too. Nothing copied here is part of the initial payload:
 *
 *  - MathJax loads only on pages that contain math. tex-svg.js carries the common
 *    glyphs; rarer character ranges and the speech engine are fetched as needed.
 *  - pdf.js itself is bundled (and lazy). What is copied here are the files it asks
 *    for only when a particular PDF needs them: the 14 standard fonts for documents
 *    that do not embed theirs, character maps for CJK text, colour profiles, and the
 *    WebAssembly image decoders for JPEG 2000 and JBIG2 scans.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const vendor = resolve(root, "public/vendor");
const out = resolve(vendor, "mathjax");

const mathjax = dirname(require.resolve("mathjax/package.json"));
const font = dirname(require.resolve("@mathjax/mathjax-newcm-font/package.json"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(mathjax, "tex-svg.js"), resolve(out, "tex-svg.js"));
cpSync(resolve(mathjax, "LICENSE"), resolve(out, "LICENSE"));
cpSync(resolve(font, "svg/dynamic"), resolve(out, "fonts/mathjax-newcm-font/svg/dynamic"), {
  recursive: true,
});

// The speech rule engine: it lets screen readers speak an equation and lets keyboard
// users explore it. It runs in a worker, started only on pages with math. English
// rules and the braille tables are shipped; other languages would be a few hundred
// kilobytes each.
cpSync(resolve(mathjax, "sre/speech-worker.js"), resolve(out, "sre/speech-worker.js"));
for (const map of ["base.json", "en.json", "nemeth.json", "euro.json"]) {
  cpSync(resolve(mathjax, "sre/mathmaps", map), resolve(out, "sre/mathmaps", map));
}

const pdfjs = dirname(require.resolve("pdfjs-dist/package.json"));
const pdfOut = resolve(vendor, "pdfjs");
rmSync(pdfOut, { recursive: true, force: true });
for (const dir of ["standard_fonts", "cmaps", "iccs", "wasm"]) {
  cpSync(resolve(pdfjs, dir), resolve(pdfOut, dir), { recursive: true });
}
cpSync(resolve(pdfjs, "LICENSE"), resolve(pdfOut, "LICENSE"));

console.log(`Vendored MathJax and pdf.js support files into ${vendor}`);
