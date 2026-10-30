import { test, expect } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "../fixtures/ocw-modern.zip");

/**
 * Two browser contexts stand in for two devices: separate storage, the same server.
 * Progress made on the first must reach the second through a sync link.
 */
test("progress syncs to a second device through a sync link", async ({ browser }) => {
  const laptop = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  laptop.on("pageerror", (error) => errors.push(error.message));

  await laptop.goto("/import");
  await laptop.setInputFiles('input[type="file"]', fixture);
  await expect(laptop.getByRole("heading", { name: "Foundations of Widgetry", level: 1 })).toBeVisible({ timeout: 30_000 });
  await laptop.getByRole("navigation", { name: "Course contents" }).getByRole("link", { name: "1. Introduction" }).click();
  await laptop.getByRole("button", { name: /Solid/ }).click();
  await expect(laptop.getByText(/You will see this again/)).toBeVisible();

  await laptop.goto("/settings");
  await laptop.getByRole("button", { name: "Turn on sync" }).click();
  await expect(laptop.getByText(/Synced with/)).toBeVisible({ timeout: 15_000 });
  await laptop.getByRole("button", { name: "Add another device" }).click();
  await expect(laptop.getByRole("img", { name: "QR code of the sync link" })).toBeVisible();
  const link = (await laptop.locator(".pairing__link").textContent())!;
  expect(link).toMatch(/\/pair#k=[\w-]{43}$/);

  // The second device has nothing yet.
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(link);
  // The secret is cleared from the address bar as soon as it has been read.
  await expect(phone).toHaveURL(/\/pair$/);
  await phone.getByRole("button", { name: "Connect" }).click();
  await expect(phone.getByText(/Synced with/)).toBeVisible({ timeout: 15_000 });

  // The phone has not imported the course, but its progress for it has arrived and is
  // waiting: importing the same course there picks it up, because both devices give a
  // course the same id.
  await expect(phone.getByText(/1 course so far/).first()).toBeVisible();
  const synced = await phone.evaluate(() => JSON.parse(localStorage.getItem("open-ed-web:sync")!).etag as string);
  expect(synced).toBe('"1"');

  expect(errors).toEqual([]);
});

test("a sync link with a bad secret explains itself", async ({ page }) => {
  await page.goto("/pair#k=short");
  await expect(page.getByRole("alert")).toContainText("not a complete sync link");
});

test("courses in the library download to other devices from OCW, not from the server", async ({ browser }) => {
  const laptop = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  laptop.on("pageerror", (error) => errors.push(error.message));

  await laptop.goto("/import");
  await laptop.setInputFiles('input[type="file"]', fixture);
  await expect(laptop.getByRole("heading", { name: "Foundations of Widgetry", level: 1 })).toBeVisible({ timeout: 30_000 });
  await laptop.goto("/settings");
  await expect(laptop.getByText(/1 course so far/).first()).toBeVisible();
  await laptop.getByRole("button", { name: "Turn on sync" }).click();
  await expect(laptop.getByText(/Synced with/)).toBeVisible({ timeout: 15_000 });
  await laptop.getByRole("button", { name: "Add another device" }).click();
  const link = (await laptop.locator(".pairing__link").textContent())!;

  // The second device fetches the archive from where OCW publishes it. Here that
  // address answers with the test course, as ocw.mit.edu would with the real one.
  const phoneContext = await browser.newContext();
  const fetched: string[] = [];
  await phoneContext.route("https://ocw.mit.edu/**", async (route) => {
    fetched.push(route.request().url());
    await route.fulfill({
      path: fixture,
      headers: { "Content-Type": "application/zip", "Access-Control-Allow-Origin": "*" },
    });
  });
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(link);
  await phone.getByRole("button", { name: "Connect" }).click();
  await expect(phone.getByText(/Synced with/)).toBeVisible({ timeout: 15_000 });

  // With automatic downloads on (the default), the course arrives by itself.
  await phone.goto("/courses");
  await expect(phone.getByRole("link", { name: /Foundations of Widgetry/ })).toBeVisible({ timeout: 30_000 });
  // (A page reload mid-download restarts it, so it may have been fetched more than once.)
  expect(new Set(fetched)).toEqual(new Set(["https://ocw.mit.edu/courses/1-001-foundations-of-widgetry-fall-2024/1.001-fall-2024.zip"]));
  await phone.getByRole("link", { name: /Foundations of Widgetry/ }).click();
  await phone.getByRole("navigation", { name: "Course contents" }).getByRole("link", { name: "Lecture Notes" }).click();
  await phone.locator(".prose a[data-page-uid]").first().click();
  await expect(phone.locator(".textLayer")).toContainText("Widget notes for lecture one", { timeout: 15_000 });

  // Removed from this device only: it is offered again rather than re-downloaded.
  await phone.goto("/settings");
  phone.once("dialog", (dialog) => void dialog.accept());
  await phone.getByRole("button", { name: "Remove from this device" }).click();
  await expect(phone.getByRole("button", { name: "Remove from this device" })).toHaveCount(0);
  const before = fetched.length;
  await phone.goto("/courses");
  await expect(phone.getByText("In your library, not on this device")).toBeVisible();
  await phone.waitForTimeout(1500);
  expect(fetched).toHaveLength(before);
  await phone.getByRole("button", { name: "Download" }).click();
  await expect(phone.getByRole("link", { name: /Foundations of Widgetry/ })).toBeVisible({ timeout: 30_000 });

  expect(errors).toEqual([]);
});

test("moving to a new device with progress.json brings the courses along", async ({ browser }) => {
  const old = await (await browser.newContext()).newPage();
  await old.goto("/import");
  await old.setInputFiles('input[type="file"]', fixture);
  await expect(old.getByRole("heading", { name: "Foundations of Widgetry", level: 1 })).toBeVisible({ timeout: 30_000 });
  await old.getByRole("navigation", { name: "Course contents" }).getByRole("link", { name: "1. Introduction" }).click();
  await old.getByRole("button", { name: /Solid/ }).click();
  await expect(old.getByText(/You will see this again/)).toBeVisible();

  await old.goto("/settings");
  const download = old.waitForEvent("download");
  await old.getByRole("button", { name: "Export progress.json" }).click();
  const file = await (await download).path();

  // A new device, no sync: just the file.
  const context = await browser.newContext();
  await context.route("https://ocw.mit.edu/**", (route) =>
    route.fulfill({ path: fixture, headers: { "Content-Type": "application/zip", "Access-Control-Allow-Origin": "*" } }),
  );
  const fresh = await context.newPage();
  await fresh.goto("/settings");
  await fresh.setInputFiles('input[type="file"][accept*="json"]', file);
  await expect(fresh.getByRole("status")).toContainText("1 not on this device yet");

  await fresh.goto("/courses");
  await expect(fresh.getByRole("link", { name: /Foundations of Widgetry/ })).toBeVisible({ timeout: 30_000 });
  await fresh.goto("/");
  await expect(fresh.locator(".stat").filter({ hasText: "Day streak" })).toContainText("1");
});
