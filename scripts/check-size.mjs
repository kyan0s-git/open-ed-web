/**
 * Enforce the initial-payload budget.
 *
 * The whole argument for this stack over a heavier one is the size of what a reader
 * downloads before anything is on screen, so that number is checked rather than
 * assumed. Lazy chunks are exempt: they are the point of splitting.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET_KB = 150;

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/assets");
const html = readFileSync(resolve(dist, "../index.html"), "utf8");

// Only what index.html pulls in eagerly counts: the entry module and its preloads.
const eager = new Set(
  [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((m) => m[1]),
);

if (eager.size === 0) {
  console.error("No eager assets found in dist/index.html — did the build run?");
  process.exit(1);
}

let total = 0;
const rows = [];
for (const name of readdirSync(dist)) {
  if (!eager.has(name)) continue;
  const bytes = gzipSync(readFileSync(resolve(dist, name)), { level: 9 }).length;
  total += bytes;
  rows.push([name, bytes]);
}

for (const [name, bytes] of rows.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(bytes / 1024).toFixed(1).padStart(7)} KB gz  ${name}`);
}

const totalKb = total / 1024;
console.log(`\nInitial payload: ${totalKb.toFixed(1)} KB gz (budget ${BUDGET_KB} KB)`);

if (totalKb > BUDGET_KB) {
  console.error(`\nOver budget by ${(totalKb - BUDGET_KB).toFixed(1)} KB.`);
  process.exit(1);
}
