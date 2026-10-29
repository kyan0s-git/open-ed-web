/**
 * Build synthetic OCW course archives for tests.
 *
 * These reproduce the output an OCW Hugo build actually emits, taken from the
 * upstream templates:
 *   - ocw-hugo-projects/ocw-course-v2/config.yaml declares the `coursedata` and
 *     `contentmap` output formats -> data.json beside every page, content_map.json
 *     at the site root.
 *   - course-v2/layouts/partials/course_content.json merges page params with
 *     rendered content.
 *   - course-v2/layouts/partials/nav_item.html renders the sidebar this parses.
 *   - course-v2/layouts/partials/quiz_multiple_choice_choice.html marks the
 *     correct answer with `correctness-icon-correct`.
 *
 * When a real archive is available, add it under fixtures/ and point the tests at
 * it; the parser should need no changes.
 */
import { zipSync, strToU8 } from "fflate";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "fixtures");

const uid = {
  syllabus: "11111111-1111-1111-1111-111111111111",
  lectures: "22222222-2222-2222-2222-222222222222",
  lecture1: "33333333-3333-3333-3333-333333333333",
  lecture2: "44444444-4444-4444-4444-444444444444",
  notesPdf: "55555555-5555-5555-5555-555555555555",
  video1: "66666666-6666-6666-6666-666666666666",
  quiz: "77777777-7777-7777-7777-777777777777",
  videoDuplicate: "88888888-8888-8888-8888-888888888888",
  captionSrt: "99999999-9999-9999-9999-999999999999",
  transcript: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

const navItem = (id, name, href, children = "") => `
  <li class="course-nav-list-item">
    <div class="course-nav-parent">
      <span class="course-nav-text-wrapper">
        <a class="text-dark nav-link" data-uuid="${id}" href="${href ?? "#"}">${name}</a>
      </span>
      ${children ? `<button class="course-nav-section-toggle" data-uuid="${id}"></button>` : ""}
    </div>
    <ul class="course-nav-child-nav m-auto collapse">${children}</ul>
  </li>`;

const indexHtml = `<!doctype html>
<html lang="en"><head><title>Foundations of Widgetry</title></head>
<body>
<nav class="course-nav" aria-label="Course materials">
  <ul class="w-100 m-auto list-unstyled">
    ${navItem(uid.syllabus, "Syllabus", "/courses/1-001-foundations-of-widgetry-fall-2024/pages/syllabus/")}
    ${navItem(
      uid.lectures,
      "Lecture Notes",
      null,
      navItem(uid.lecture1, "1. Introduction", "/courses/1-001-foundations-of-widgetry-fall-2024/pages/lectures/lecture-1/") +
        navItem(uid.lecture2, "2. Widget Algebra", "/courses/1-001-foundations-of-widgetry-fall-2024/pages/lectures/lecture-2/"),
    )}
    ${navItem(uid.quiz, "Self-Check", "/courses/1-001-foundations-of-widgetry-fall-2024/pages/self-check/")}
  </ul>
</nav>
</body></html>`;

const courseData = {
  course_title: "Foundations of Widgetry",
  primary_course_number: "1.001",
  term: "Fall",
  year: "2024",
  level: ["Undergraduate"],
  topics: [["Engineering", "Mechanical Engineering", "Widget Design"], ["Mathematics", "Algebra"]],
  course_description: "A course about widgets.",
  course_description_html: "<p>A course about <strong>widgets</strong>.</p>",
  instructors: [
    { title: "Prof. Ada Lovelace", first_name: "Ada", last_name: "Lovelace" },
    { first_name: "Grace", last_name: "Hopper", salutation: "Dr." },
  ],
  site_uid: "00000000-0000-0000-0000-000000000000",
  site_short_id: "1.001-fall-2024",
  site_url_path: "courses/1-001-foundations-of-widgetry-fall-2024",
  image_src: "./static_resources/cover.jpg",
  license: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

const quizHtml = `
<div class="multiple-choice-question" id="q1"><p>What is a widget?</p></div>
<div class="multiple-choice-div">
  <label class="d-flex align-items-center">
    <input type="radio" name="q1" class="multiple-choice-radio">A small thing
    <span class="toggle material-icons correctness-icon correctness-icon-wrong">close</span>
  </label>
</div>
<div class="multiple-choice-div">
  <label class="d-flex align-items-center">
    <input type="radio" name="q1" class="multiple-choice-radio">A unit of widgetry
    <span class="toggle material-icons correctness-icon correctness-icon-correct">check</span>
  </label>
</div>
<div class="multiple-choice-question" id="q2"><p>Ungraded prompt with no key</p></div>
<div class="multiple-choice-div">
  <label><input type="radio" name="q2" class="multiple-choice-radio">Maybe</label>
</div>`;

const SLUG = "/courses/1-001-foundations-of-widgetry-fall-2024";

// Mirrors the real archive (8.04, Spring 2016): resources carry no parent_uid and are
// reached only through links on a page, written relative to that page.
const pages = {
  "pages/syllabus": {
    uid: uid.syllabus,
    content_type: "page",
    title: "Syllabus",
    description: "Course syllabus",
    learning_resource_types: [],
    content:
      "<h2>Overview</h2><p>Meets twice weekly. Start with the <a href='../../pages/lectures/lecture-1/index.html'>first lecture</a>.</p>",
  },
  "pages/lectures": {
    uid: uid.lectures,
    content_type: "page",
    title: "Lecture Notes",
    learning_resource_types: ["Lecture Notes"],
    // An index of links, like OCW's real lecture-notes pages: not itself a skill.
    content:
      "<table><tr><td>1</td><td><a href='../../resources/lecture-1-notes/index.html'>Lecture 1 Notes (PDF)</a></td></tr></table>",
  },
  "pages/lectures/lecture-1": {
    uid: uid.lecture1,
    parent_uid: uid.lectures,
    content_type: "page",
    title: "1. Introduction",
    learning_resource_types: ["Lecture Notes", "Lecture Videos"],
    content:
      "<h2>Introduction</h2><p>Widgets, broadly, are the smallest units of widgetry studied in this course.</p>" +
      "<h3>Reading</h3><p>Chapter 1, with particular attention to the conservation law \\(W = w_1 + w_2\\) and</p>" +
      "<p>$$\\int_0^1 w(t)\\,dt = 1$$</p>" +
      "<p><a href='../../../resources/lecture-1-notes/index.html'>Notes (PDF)</a> · " +
      "<a href='../../../resources/lecture-1-video/index.html'>Video</a></p>",
  },
  "pages/lectures/lecture-2": {
    uid: uid.lecture2,
    parent_uid: uid.lectures,
    content_type: "page",
    title: "2. Widget Algebra",
    learning_resource_types: ["Lecture Notes"],
    content: "<h2>Widget Algebra</h2><p>Composition of widgets, and why it is associative but not commutative.</p>",
  },
  "pages/self-check": {
    uid: uid.quiz,
    content_type: "page",
    title: "Self-Check",
    content: quizHtml,
  },
  "resources/lecture-1-notes": {
    uid: uid.notesPdf,
    content_type: "resource",
    title: "Lecture 1 Notes",
    resourcetype: "Document",
    file: `${SLUG}/0a1b_lec1.pdf`,
    file_type: "application/pdf",
    file_size: 24,
    learning_resource_types: ["Lecture Notes"],
    language: "en",
    content: "<p>Notes for lecture 1.</p>",
  },
  "resources/lecture-1-video": {
    uid: uid.video1,
    content_type: "resource",
    title: "Lecture 1 Video",
    resourcetype: "Video",
    file: null,
    // Real archives write this as a string for videos.
    file_size: "41937317",
    learning_resource_types: ["Lecture Videos"],
    video_metadata: { youtube_id: "dQw4w9WgXcQ", youtube_description: "Lecture 1" },
    video_files: {
      archive_url: "https://archive.org/download/example/lec01.mp4",
      video_captions_file: `${SLUG}/0c1d_dQw4w9WgXcQ.vtt`,
      video_transcript_file: `${SLUG}/0e1f_dQw4w9WgXcQ.pdf`,
    },
    content: "",
  },
  // The same video published a second time under another slug, linked from nowhere.
  "resources/lecture-1-video-2": {
    uid: uid.videoDuplicate,
    content_type: "resource",
    title: "Lecture 1 Video",
    resourcetype: "Video",
    file: null,
    learning_resource_types: ["Lecture Videos"],
    video_metadata: { youtube_id: "dQw4w9WgXcQ" },
    content: "",
  },
  // Sidecars: a transcript the video points at, and SubRip captions nothing points at.
  "resources/dqw4w9wgxcq": {
    uid: uid.transcript,
    content_type: "resource",
    title: "Lecture 1 Transcript",
    resourcetype: "Document",
    file: `${SLUG}/0e1f_dQw4w9WgXcQ.pdf`,
    file_type: "application/pdf",
    content: "",
  },
  "resources/dqw4w9wgxcq-2": {
    uid: uid.captionSrt,
    content_type: "resource",
    title: "3play caption file",
    resourcetype: "Other",
    file: `${SLUG}/0g1h_dQw4w9WgXcQ.srt`,
    file_type: "application/x-subrip",
    content: "",
  },
};

// The real content map points at each record's data.json, not its page.
const contentMap = Object.fromEntries(
  Object.entries(pages).map(([path, data]) => [data.uid, `/${path}/data.json`]),
);

/** Modern archive: rendered HTML plus the coursedata/contentmap JSON outputs. */
function modernArchive() {
  const files = {
    "index.html": strToU8(indexHtml),
    "data.json": strToU8(JSON.stringify(courseData, null, 2)),
    "content_map.json": strToU8(JSON.stringify(contentMap, null, 2)),
    "static_resources/0a1b_lec1.pdf": strToU8("%PDF-1.4 fixture\n"),
    "static_resources/0c1d_dQw4w9WgXcQ.vtt": strToU8("WEBVTT\n"),
    "static_resources/0e1f_dQw4w9WgXcQ.pdf": strToU8("%PDF-1.4 transcript\n"),
    "static_resources/0g1h_dQw4w9WgXcQ.srt": strToU8("1\n"),
    "static_resources/cover.jpg": strToU8("jpg"),
    // Section listings publish a data.json with no uid; they are not content.
    "pages/data.json": strToU8(JSON.stringify({ content: "", draft: false })),
  };
  for (const [path, data] of Object.entries(pages)) {
    files[`${path}/data.json`] = strToU8(JSON.stringify(data, null, 2));
    files[`${path}/index.html`] = strToU8(`<html><body>${data.content ?? ""}</body></html>`);
  }
  // Real downloads nest the site under a folder named for the course.
  return withRoot("1-001-foundations-of-widgetry-fall-2024/", files);
}

/** Same course exported without the JSON outputs, to exercise detection. */
function htmlOnlyArchive() {
  return {
    "index.html": strToU8(indexHtml),
    "static_resources/lec1.pdf": strToU8("%PDF-1.4 fixture\n"),
    "pages/syllabus/index.html": strToU8("<html><body><p>Syllabus</p></body></html>"),
  };
}

/** Pre-2022 package, which the importer must recognise and refuse clearly. */
function legacyArchive() {
  return {
    "imsmanifest.xml": strToU8('<?xml version="1.0"?><manifest identifier="legacy"></manifest>'),
    "contents/index.htm": strToU8("<html><body>Legacy course</body></html>"),
  };
}

function stripRoot(files) {
  return Object.fromEntries(
    Object.entries(files).map(([p, d]) => [p.slice(p.indexOf("/") + 1), d]),
  );
}

function withRoot(prefix, files) {
  return Object.fromEntries(Object.entries(files).map(([p, d]) => [prefix + p, d]));
}

mkdirSync(out, { recursive: true });
for (const [name, files] of [
  ["ocw-modern.zip", modernArchive()],
  // Real downloads put the site at the archive root, with no wrapping folder.
  ["ocw-modern-flat.zip", stripRoot(modernArchive())],
  ["ocw-html-only.zip", htmlOnlyArchive()],
  ["ocw-legacy.zip", legacyArchive()],
]) {
  const bytes = zipSync(files, { level: 6 });
  writeFileSync(resolve(out, name), bytes);
  console.log(`${name}: ${Object.keys(files).length} entries, ${bytes.length} bytes`);
}

writeFileSync(resolve(out, "uids.json"), JSON.stringify(uid, null, 2) + "\n");
