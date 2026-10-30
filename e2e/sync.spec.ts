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
