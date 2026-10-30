import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // The import worker code-splits (it loads its HTML parser lazily), which rules out
  // the default iife worker format. It is constructed with { type: "module" } to match.
  worker: { format: "es" },
  build: {
    target: "es2022",
    // Chunking is left to Rollup's reachability analysis on purpose. Hand-written
    // manualChunks produced shared chunks that Vite then preloaded from index.html,
    // pulling the archive reader into the initial payload even though only lazy routes
    // use it. The budget in scripts/check-size.mjs is what keeps this honest.
  },
  test: {
    // The importer parses course HTML with DOMParser, which the browser provides
    // for free. happy-dom supplies it in tests.
    environment: "happy-dom",
    // A browser's DOMParser produces inert documents; happy-dom's would otherwise fetch
    // the stylesheets and scripts a course page references. Match the browser.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          disableIframePageLoading: true,
        },
      },
    },
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
