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
  await expect(phone.getByText(/1 course so far/)).toBeVisible();
  const synced = await phone.evaluate(() => JSON.parse(localStorage.getItem("open-ed-web:sync")!).etag as string);
  expect(synced).toBe('"1"');

  expect(errors).toEqual([]);
});

test("a sync link with a bad secret explains itself", async ({ page }) => {
  await page.goto("/pair#k=short");
  await expect(page.getByRole("alert")).toContainText("not a complete sync link");
});

test("a course stored on the server downloads to a second device, only when turned on", async ({ browser }) => {
  const laptop = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  laptop.on("pageerror", (error) => errors.push(error.message));

  // Turn on sync and course storage first, so the import uploads on its own.
  await laptop.goto("/settings");
  await laptop.getByRole("button", { name: "Turn on sync" }).click();
  await expect(laptop.getByText(/Synced with/)).toBeVisible({ timeout: 15_000 });
  await laptop.getByLabel(/Store courses on the sync server/).check();
  await expect(laptop.getByLabel(/Upload courses I import/)).toBeChecked();

  await laptop.goto("/import");
  await laptop.setInputFiles('input[type="file"]', fixture);
  await expect(laptop.getByRole("heading", { name: "Foundations of Widgetry", level: 1 })).toBeVisible({ timeout: 30_000 });
  await laptop.goto("/settings");
  await expect(laptop.getByText("On server")).toBeVisible({ timeout: 30_000 });
  await expect(laptop.getByText(/Using .* on the server/)).toBeVisible();
  await laptop.getByRole("button", { name: "Add another device" }).click();
  const link = (await laptop.locator(".pairing__link").textContent())!;

  const phone = await (await browser.newContext()).newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(link);
  await phone.getByRole("button", { name: "Connect" }).click();
  await expect(phone.getByText(/Synced with/)).toBeVisible({ timeout: 15_000 });

  // Course storage is off on a device until it is turned on there.
  await phone.goto("/courses");
  await expect(phone.getByText("On your sync server")).toHaveCount(0);

  await phone.goto("/settings");
  await phone.getByLabel(/Store courses on the sync server/).check();
  await phone.goto("/courses");
  await expect(phone.getByText("On your sync server")).toBeVisible();
  await phone.getByRole("button", { name: "Download" }).click();

  // Downloaded, reassembled, imported: the course is now on the phone and opens.
  await expect(phone.getByRole("link", { name: /Foundations of Widgetry/ })).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByText("On your sync server")).toHaveCount(0);
  await phone.getByRole("link", { name: /Foundations of Widgetry/ }).click();
  await phone.getByRole("navigation", { name: "Course contents" }).getByRole("link", { name: "Lecture Notes" }).click();
  await phone.locator(".prose a[data-page-uid]").first().click();
  await expect(phone.locator(".textLayer")).toContainText("Widget notes for lecture one", { timeout: 15_000 });

  // Removing it from the server leaves both devices' copies alone.
  await laptop.goto("/settings");
  laptop.once("dialog", (dialog) => void dialog.accept());
  await laptop.getByRole("button", { name: "Remove from server" }).click();
  await expect(laptop.getByRole("button", { name: "Upload to server" })).toBeVisible();
  await expect(laptop.getByText(/Using 0 B of/)).toBeVisible({ timeout: 10_000 }).catch(() => {});

  expect(errors).toEqual([]);
});
