/**
 * Math typesetting with MathJax.
 *
 * OCW authors its math for MathJax, so MathJax is what renders it here — the same
 * macros and the same output the course was written against. It is large (about
 * 600 KB gzipped, fonts included), so it is loaded only when a page actually contains
 * math, and served from this site rather than a CDN so it works offline — including
 * the speech engine that makes equations accessible to screen readers.
 */

declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (elements?: Element[]) => Promise<void>;
      typesetClear?: (elements?: Element[]) => void;
      startup?: { promise?: Promise<void>; [key: string]: unknown };
      [key: string]: unknown;
    };
  }
}

/**
 * Delimiters OCW content uses. A lone `$` is deliberately not one: course prose talks
 * about money ("costs $5 to $10") far more often than it writes inline TeX that way.
 */
const MATH_PATTERN = /\\\(|\\\[|\$\$|\\begin\{|<math[\s>]/;

export function hasMath(html: string): boolean {
  return MATH_PATTERN.test(html);
}

let loading: Promise<NonNullable<Window["MathJax"]>> | null = null;

function loadMathJax(): Promise<NonNullable<Window["MathJax"]>> {
  if (loading) return loading;

  const base = `${import.meta.env.BASE_URL}vendor/mathjax`;

  // MathJax reads its configuration from window.MathJax before the script runs.
  window.MathJax = {
    loader: {
      load: [],
      // Rarer glyph ranges are fetched from here on demand, not from jsDelivr.
      paths: { fonts: `${base}/fonts` },
    },
    tex: {
      inlineMath: { "[+]": [["\\(", "\\)"]] },
      displayMath: [
        ["$$", "$$"],
        ["\\[", "\\]"],
      ],
      processEscapes: true,
    },
    svg: { fontCache: "global" },
    // MathJax's accessibility defaults stay on: screen readers speak each equation,
    // keyboard users can explore it, and the context menu offers "copy as TeX".
    startup: { typeset: false },
  };

  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${base}/tex-svg.js`;
    script.async = true;
    script.onload = () => {
      const mathJax = window.MathJax;
      if (!mathJax?.startup?.promise) {
        reject(new Error("MathJax loaded but did not start."));
        return;
      }
      mathJax.startup.promise.then(() => resolve(mathJax), reject);
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("MathJax could not be loaded."));
    };
    document.head.append(script);
  });

  return loading;
}

/**
 * Typeset the math inside an element. A failure leaves the TeX source visible, which
 * is still readable, rather than blanking the page.
 */
export async function typesetMath(element: Element): Promise<void> {
  try {
    const mathJax = await loadMathJax();
    mathJax.typesetClear?.([element]);
    await mathJax.typesetPromise?.([element]);
  } catch (error) {
    console.warn("Math could not be typeset:", error);
  }
}
