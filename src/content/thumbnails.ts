import type { Course } from "@/content/schema";
import { db } from "@/storage/db";
import { readAsset } from "./assets";
import { loadPdfJs, PDF_SUPPORT } from "./pdfjs";

/**
 * Pictures for things that do not come with one.
 *
 * Most OCW courses ship a cover image, but some do not, and some ship one the browser
 * cannot decode. For those, the cover is the first page of the course's own notes,
 * rendered once with pdf.js and kept as a small JPEG beside the course's other cached
 * data. pdf.js loads only when a thumbnail actually has to be drawn.
 */

const WIDTH = 480;

/** Prefer notes and the syllabus, by title; any PDF will do. */
const PREFERRED = [/lecture|notes/i, /syllabus/i, /reading/i];

/** The course's cover: its own image if that decodes, else a rendered page, else null. */
export async function courseCover(course: Course): Promise<Blob | null> {
  if (course.imagePath) {
    const image = await readAsset(course.id, course.imagePath).catch(() => null);
    if (image && (await decodes(image))) return image;
  }
  const pdf = await coverPdf(course);
  return pdf ? pdfThumbnail(course.id, pdf) : null;
}

async function coverPdf(course: Course): Promise<string | null> {
  const resources = await db.resources.where("courseId").equals(course.id).toArray();
  const pdfs = resources.filter((resource) => resource.zipPath && (resource.mime === "application/pdf" || /\.pdf$/i.test(resource.zipPath)));
  if (pdfs.length === 0) return null;

  // Study order, so the first lecture's notes win over the last problem set's.
  const position = new Map(course.sequence.map((uid, index) => [uid, index]));
  const rank = (resource: (typeof pdfs)[number]) => {
    const preferred = PREFERRED.findIndex((pattern) => pattern.test(resource.title));
    return [preferred < 0 ? PREFERRED.length : preferred, position.get(resource.uid) ?? Infinity] as const;
  };
  pdfs.sort((a, b) => {
    const [ka, pa] = rank(a);
    const [kb, pb] = rank(b);
    return ka - kb || pa - pb;
  });
  return pdfs[0]!.zipPath;
}

/** Thumbnails are drawn one at a time, so a page of course cards does not spike. */
let queue: Promise<unknown> = Promise.resolve();

/** The first page of a PDF in a course archive, as a JPEG; cached after the first call. */
export function pdfThumbnail(courseId: string, zipPath: string): Promise<Blob | null> {
  const key = `${courseId}|${zipPath}`;
  const task = queue.then(async () => {
    const cached = await db.thumbnails.get(key);
    if (cached) return cached.image;
    const image = await render(courseId, zipPath).catch(() => null);
    await db.thumbnails.put({ key, courseId, image }).catch(() => {});
    return image;
  });
  queue = task.catch(() => {});
  return task;
}

async function render(courseId: string, zipPath: string): Promise<Blob | null> {
  const [pdfjs, file] = await Promise.all([loadPdfJs(), readAsset(courseId, zipPath, "application/pdf")]);
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...PDF_SUPPORT });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / base.width });

    const canvas = window.document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport }).promise;
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  } finally {
    await task.destroy();
  }
}

async function decodes(image: Blob): Promise<boolean> {
  if (typeof createImageBitmap !== "function") return true;
  try {
    (await createImageBitmap(image)).close();
    return true;
  } catch {
    return false;
  }
}
