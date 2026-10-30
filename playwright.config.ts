import { defineConfig } from "@playwright/test";

/**
 * By default the tests start the self-hosted server (web app + sync API) on port 4173;
 * `npm run e2e` builds both first. Vaults are kept in memory, so every run starts clean.
 * Course storage is on, with tiny chunks so the small test course spans several.
 *
 * Set E2E_BASE_URL to run the same tests against another deployment instead, such as
 * `wrangler dev` or a preview URL, to check that host's adapter end to end.
 */
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: external ?? "http://localhost:4173",
    // Use a Chromium that is already on the machine when one is provided, rather than
    // downloading a build to match the pinned Playwright version.
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  webServer: external
    ? undefined
    : {
        command: "node server-dist/node.mjs",
        env: { PORT: "4173", HOST: "127.0.0.1", DATA_DIR: "memory", COURSE_STORAGE: "on", COURSE_CHUNK_BYTES: "4096" },
        url: "http://localhost:4173",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
