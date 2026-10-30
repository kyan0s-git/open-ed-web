import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "../fixtures/ocw-modern.zip");

/**
 * The path a real user takes, in a real browser.
 *
 * Unit tests cover the parsers, but they cannot exercise what breaks in practice: the
 * import worker, the private file system, IndexedDB, MathJax, pdf.js, and whether the
 * imported markup renders. These do.
 */

async function importFixture(page: Page) {
  await page.goto("/import");
  await page.setInputFiles('input[type="file"]', fixture);
  await expect(page.getByRole("heading", { name: "Foundations of Widgetry", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
}

const contents = (page: Page) => page.getByRole("navigation", { name: "Course contents" });

test("import an archive, read it, and rate what you read", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await importFixture(page);
  await expect(page.getByText("1.001 · Fall 2024 · Undergraduate")).toBeVisible();

  // The sidebar reproduces the archive's own order and nesting.
  await expect(contents(page).getByRole("link", { name: "Syllabus" })).toBeVisible();
  await contents(page).getByRole("link", { name: "1. Introduction" }).click();
  await expect(page.getByRole("heading", { name: "1. Introduction", level: 1 })).toBeVisible();
  await expect(page.getByText("Widgets, broadly")).toBeVisible();

  // Rating it schedules a review, and the confirmation waits for the save.
  await page.getByRole("button", { name: /Solid/ }).click();
  await expect(page.getByText(/You will see this again/)).toBeVisible();

  // Next follows study order: the lecture's video comes after the lecture.
  await page.getByRole("link", { name: /Next/ }).click();
  await expect(page.getByRole("heading", { name: "Lecture 1 Video", level: 1 })).toBeVisible();

  expect(errors).toEqual([]);
});

test("math is typeset by MathJax, from this site only", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!/^(http:\/\/localhost|blob:|data:)/.test(url)) external.push(url);
  });

  await importFixture(page);
  await contents(page).getByRole("link", { name: "1. Introduction" }).click();

  await expect(page.locator("mjx-container").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('mjx-container[display="true"]')).toHaveCount(1);
  // No raw TeX left behind.
  await expect(page.locator(".prose").first()).not.toContainText("\\(");
  expect(external).toEqual([]);
});

test("PDFs open in the reader's viewer with selectable text", async ({ page }) => {
  await importFixture(page);
  await contents(page).getByRole("link", { name: "Lecture Notes" }).click();
  await page.locator(".prose a[data-page-uid]").first().click();

  await expect(page.getByRole("heading", { name: "Lecture 1 Notes", level: 1 })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: /Lecture 1 Notes controls/ })).toBeVisible();
  await expect(page.locator(".pdf__page")).toContainText("/ 1");
  await expect(page.locator(".pdf__sheet canvas")).toHaveCount(1);
  // The text layer carries the page's words, so they can be selected and found.
  await expect(page.locator(".textLayer")).toContainText("Widget notes for lecture one", { timeout: 15_000 });
});

test("progress survives a reload and exports as readable JSON", async ({ page }) => {
  await importFixture(page);
  await contents(page).getByRole("link", { name: "2. Widget Algebra" }).click();
  await page.getByRole("button", { name: /Easy/ }).click();
  await expect(page.getByText(/You will see this again/)).toBeVisible();

  await page.reload();
  await page.goto("/courses");
  await expect(page.getByRole("link", { name: /Foundations of Widgetry/ })).toBeVisible();

  // The dashboard reflects the review.
  await page.goto("/");
  await expect(page.getByText("Day streak")).toBeVisible();
  await expect(page.locator(".stat").filter({ hasText: "Day streak" })).toContainText("1");

  await page.goto("/settings");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export progress.json" }).click();

  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const doc = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  expect(doc.schema).toBe("openedweb.progress/1");
  const course = Object.values(doc.courses)[0] as { skills: Record<string, unknown> };
  expect(Object.keys(course.skills).length).toBeGreaterThan(0);
  expect(Object.values(doc.activity)).toEqual([expect.objectContaining({ reviews: 1 })]);
});

test("search finds pages as you type and PDF text once indexed", async ({ page }) => {
  await importFixture(page);

  // "/" opens search, scoped to the course you are in.
  await page.keyboard.press("/");
  await expect(page).toHaveURL(/\/search\?course=/);
  const box = page.getByRole("searchbox", { name: "Search" });
  await expect(box).toBeFocused();

  // Pages and titles are searchable straight after import.
  await box.fill("associative");
  await expect(page.locator(".result").first()).toContainText("2. Widget Algebra");

  // PDF text arrives from the background indexer; accents and case are optional.
  await box.fill("LECTURE ONE widget");
  await page.getByRole("button", { name: "Notes & PDFs" }).click();
  const hit = page.locator(".result").filter({ hasText: "PDF · page 1" });
  await expect(hit).toBeVisible({ timeout: 30_000 });
  await expect(hit.locator("mark").first()).toBeVisible();

  // Opening it lands in the viewer with the words highlighted in the page text.
  await hit.click();
  await expect(page.getByRole("heading", { name: "Lecture 1 Notes", level: 1 })).toBeVisible();
  await expect(page.locator(".textLayer .pdf-hit").first()).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("the theme toggle switches and persists across reloads", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /Theme:/ });

  await toggle.click(); // system -> light
  await toggle.click(); // light -> dark
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a pre-2022 archive is refused with an explanation, not a crash", async ({ page }) => {
  await page.goto("/import");
  await page.setInputFiles('input[type="file"]', resolve(here, "../fixtures/ocw-legacy.zip"));
  await expect(page.getByRole("alert")).toContainText("pre-2022");
});
