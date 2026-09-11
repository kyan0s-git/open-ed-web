import { test, expect } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "../fixtures/ocw-modern.zip");

/**
 * The path a real user takes, in a real browser.
 *
 * Unit tests cover the parsers, but they cannot exercise what actually breaks in
 * practice: the worker, the private file system, IndexedDB, and whether the imported
 * markup renders. This does.
 */
test("import an archive, read it, and rate what you read", async ({ page }) => {
  await page.goto("/import");

  await page.setInputFiles('input[type="file"]', fixture);

  // Import lands on the course once it finishes.
  await expect(page.getByRole("heading", { name: "Foundations of Widgetry" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("1.001")).toBeVisible();

  // The sidebar reproduces the archive's own order and nesting.
  const nav = page.getByRole("navigation", { name: "Course contents" });
  await expect(nav.getByRole("link", { name: "Syllabus" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "1. Introduction" })).toBeVisible();

  await nav.getByRole("link", { name: "1. Introduction" }).click();
  await expect(page.getByRole("heading", { name: "1. Introduction", level: 1 })).toBeVisible();
  await expect(page.getByText("Widgets, broadly.")).toBeVisible();

  // Materials attached to the lecture are listed, including the video with no file.
  await expect(page.getByRole("link", { name: /Lecture 1 Notes/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Lecture 1 Video/ })).toBeVisible();

  // Rating it schedules a review.
  await page.getByRole("button", { name: /Solid/ }).click();
  await expect(page.getByText(/Scheduled again/)).toBeVisible();
});

test("progress survives a reload and exports as readable JSON", async ({ page }) => {
  await page.goto("/import");
  await page.setInputFiles('input[type="file"]', fixture);
  await expect(page.getByRole("heading", { name: "Foundations of Widgetry" })).toBeVisible({
    timeout: 30_000,
  });

  const nav = page.getByRole("navigation", { name: "Course contents" });
  await nav.getByRole("link", { name: "2. Widget Algebra" }).click();
  await page.getByRole("button", { name: /Easy/ }).click();
  await expect(page.getByText(/Scheduled again/)).toBeVisible();

  await page.reload();

  // The course is still there, read from storage rather than re-imported.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Foundations of Widgetry/ })).toBeVisible();

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
});

test("a pre-2022 archive is refused with an explanation, not a crash", async ({ page }) => {
  await page.goto("/import");
  await page.setInputFiles('input[type="file"]', resolve(here, "../fixtures/ocw-legacy.zip"));

  await expect(page.getByRole("alert")).toContainText("pre-2022");
});
