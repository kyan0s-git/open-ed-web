import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    target: "es2022",
    // Keep the reader shell small: heavy, optional pieces must stay in their own
    // lazy chunks so they never land in the initial payload. See scripts/check-size.mjs.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("katex")) return "katex";
          if (id.includes("@zip.js")) return "zip";
          if (id.includes("ts-fsrs")) return "fsrs";
          if (id.includes("minisearch")) return "search";
          return undefined;
        },
      },
    },
  },
  test: {
    // The importer parses course HTML with DOMParser, which the browser provides
    // for free. happy-dom supplies it in tests.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
