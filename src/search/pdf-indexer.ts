import { useSyncExternalStore } from "react";
import { db } from "@/storage/db";
import { readAsset } from "@/content/assets";
import { loadPdfJs, PDF_SUPPORT, type PdfJs } from "@/content/pdfjs";
import { docId, type SearchDoc } from "./engine";
import { invalidateSearch } from "./client";

/**
 * Extracts the text of every PDF — lecture notes, problem sets, exams and video
 * transcripts — into the search index, one document per page so results can open the
 * right page.
 *
 * It runs after an import rather than during it, so a course opens straight away and
 * its search results fill in over the following seconds. Progress is recorded per
 * file, so closing the tab part-way loses nothing: indexing resumes where it stopped
 * the next time the app is open. The heavy lifting happens off the main thread — the
 * archive is inflated by zip.js's workers and parsed by pdf.js's — and the loop yields
 * between files.
 */

interface Target {
  key: string;
  courseId: string;
  courseTitle: string;
  zipPath: string;
  uid: string;
  kind: "pdf" | "transcript";
  title: string;
  parent?: string;
}

export interface IndexStatus {
  done: number;
  total: number;
}

let status: IndexStatus | null = null;
const listeners = new Set<() => void>();

function setStatus(next: IndexStatus | null): void {
  status = next;
  for (const listener of listeners) listener();
}

/** Progress of the PDF indexer, or null when there is nothing left to do. */
export function useIndexStatus(): IndexStatus | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
    () => null,
  );
}

async function pendingTargets(): Promise<Target[]> {
  const [courses, resources, nodes, indexed] = await Promise.all([
    db.courses.toArray(),
    db.resources.toArray(),
    db.nodes.toArray(),
    db.pdfIndex.toArray(),
  ]);

  const done = new Set(indexed.map((entry) => entry.key));
  const titles = new Map(courses.map((course) => [course.id, course.title]));
  const nodeByUid = new Map(nodes.map((node) => [node.uid, node]));
  const targets: Target[] = [];

  for (const resource of resources) {
    const courseId = (resource as typeof resource & { courseId: string }).courseId;
    const node = nodeByUid.get(resource.uid);
    // Unplaced files (course thumbnails and the like) are not course material.
    if (!node?.parentUid || !titles.has(courseId)) continue;

    const base = {
      courseId,
      courseTitle: titles.get(courseId)!,
      uid: resource.uid,
      title: resource.title,
      parent: nodeByUid.get(node.parentUid)?.title,
    };

    const isPdf = resource.mime === "application/pdf" || resource.zipPath?.toLowerCase().endsWith(".pdf");
    if (resource.zipPath && isPdf) {
      targets.push({ ...base, key: `${courseId}|${resource.zipPath}`, zipPath: resource.zipPath, kind: "pdf" });
    }
    if (resource.transcriptPath) {
      targets.push({
        ...base,
        key: `${courseId}|${resource.transcriptPath}`,
        zipPath: resource.transcriptPath,
        kind: "transcript",
      });
    }
  }

  return targets.filter((target) => !done.has(target.key));
}

let running: Promise<void> | null = null;

/** Index whatever has not been indexed yet. Safe to call repeatedly. */
export function indexPdfText(): Promise<void> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<void> {
  // Keep going until a pass finds nothing new, so a course imported mid-run is covered.
  for (;;) {
    const targets = await pendingTargets();
    if (targets.length === 0) break;

    const pdfjs = await loadPdfJs();
    // One pdf.js worker for the whole run. Without it pdf.js starts a fresh worker per
    // document, and re-initializing it 148 times was most of the time spent on 8.04.
    const worker = new pdfjs.PDFWorker();
    setStatus({ done: 0, total: targets.length });

    try {
      for (const [i, target] of targets.entries()) {
        await indexOne(pdfjs, worker, target);
        setStatus({ done: i + 1, total: targets.length });
        invalidateSearch();
        await yieldToBrowser();
      }
    } finally {
      worker.destroy();
    }
  }
  setStatus(null);
}

async function indexOne(
  pdfjs: PdfJs,
  worker: InstanceType<PdfJs["PDFWorker"]>,
  target: Target,
): Promise<void> {
  let docs: SearchDoc[] = [];
  let failed = false;

  try {
    const blob = await readAsset(target.courseId, target.zipPath, "application/pdf");
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), worker, ...PDF_SUPPORT });
    try {
      const pdf = await task.promise;
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        let text = joinText((await page.getTextContent()).items);
        // Every OCW transcript opens with "MITOCW | watch?v=…"; it is not content.
        if (target.kind === "transcript") text = text.replace(/^MITOCW \| watch\?v=\S+\s*/, "");
        page.cleanup();
        if (!text) continue;
        docs.push({
          id: docId(target.courseId, `${target.kind}:${target.uid}`, number),
          courseId: target.courseId,
          courseTitle: target.courseTitle,
          uid: target.uid,
          kind: target.kind,
          title: target.title,
          text,
          page: number,
          parent: target.parent,
          detail: target.kind === "transcript" ? "Transcript" : "PDF",
        });
      }
    } finally {
      await task.destroy();
    }
  } catch {
    // A damaged or encrypted PDF should not stop the rest; it is recorded and skipped.
    docs = [];
    failed = true;
  }

  await db.transaction("rw", [db.courses, db.searchDocs, db.pdfIndex], async () => {
    // The course may have been removed while this file was being read.
    if (!(await db.courses.get(target.courseId))) return;
    await db.searchDocs.bulkPut(docs);
    await db.pdfIndex.put({ key: target.key, courseId: target.courseId, status: failed ? "failed" : "done" });
  });
}

type TextItem = { str?: string; hasEOL?: boolean };

/**
 * Join a page's text runs into searchable prose. Words split across lines with a
 * hyphen ("phys- ical") are rejoined, or "physical" would never be found.
 */
export function joinText(items: readonly unknown[]): string {
  let text = "";
  let glue = false;
  for (const raw of items as TextItem[]) {
    const str = raw.str;
    if (str === undefined) continue;
    if (glue && str && !/^\s/.test(str) && !/\s$/.test(text)) text += " ";
    if (raw.hasEOL && /[A-Za-z]-$/.test(str)) {
      text += str.slice(0, -1);
      glue = false;
    } else {
      text += str;
      glue = true;
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Let the page handle input between files. The parsing itself runs in pdf.js's worker,
 * so a short yield is enough; there is no need to wait for idle time.
 */
function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
