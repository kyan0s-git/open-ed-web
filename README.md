# open-ed-web

Read MIT OpenCourseWare course archives as structured, mastery-tracked courses.

Everything runs in the browser. A course `.zip` never leaves your machine: it is stored
once in the browser's private file system and read by random access, so a 250 MB course
costs one write and no unpacking. Your progress lives in a portable `progress.json` you
can export, back up, or keep in a synced folder — there is no server and no database to run.

## Status

Working end to end, and verified against a real download (8.04 Quantum Physics I,
Spring 2016: 157 materials, 146 skills, parsed in about 600 ms):

- **Dashboard** with what is due, your streak, materials finished, overall mastery, a
  two-week activity chart and "continue where you left off".
- **Reader** that follows the course's own sidebar, with breadcrumbs, previous/next in
  study order (`p` / `n` on the keyboard) and a drawer on small screens.
- **PDF viewer** built on pdf.js: themed toolbar, zoom and fit-to-width, selectable
  text, a dimmed mode for reading at night, and it remembers your page.
- **Math** typeset by MathJax, the renderer OCW authors against, including spoken
  equations for screen readers.
- **Videos** from YouTube via the ids the archive carries, with transcripts from the
  archive and a download link.
- **Mastery**: FSRS scheduling from self-ratings and from OCW's own quiz questions, one
  review queue across every course.
- **Search** across every course: page text, material titles, and the full text of
  every lecture note, problem set, exam and video transcript. Results appear as you
  type, accents and small typos are forgiven, and a hit inside a PDF opens the viewer
  at that page with the words highlighted. Press `/` anywhere to search.
- **Light and dark** themes, following the system unless you pick one.

Installing as an offline app is still to come.

## Development

```
npm install
npm run dev
npm test                      # unit tests (fixtures are generated automatically)
npm run verify                # typecheck, build, size budget, unit tests
CHROMIUM_PATH=/path/to/chrome npm run e2e   # browser tests
OCW_ARCHIVE=/path/to/course.zip npx vitest run real-archive   # parse a real download
```

### Staying light

The first load is about 132 KB of JavaScript and CSS, gzipped, against a 150 KB budget
that CI enforces with `npm run size`. Everything heavy loads only when a page needs it:

| Loaded when | What | Size (gzipped) |
| --- | --- | --- |
| A course is opened | archive reader, content database | ~90 KB |
| A PDF is opened | pdf.js, plus its worker (cached after) | ~150 KB + ~380 KB |
| Search is used | search worker with MiniSearch | ~35 KB |
| A page contains math | MathJax with fonts | ~600 KB |
| Text is shown | two variable fonts, only the faces and scripts used | ~35–90 KB |

PDF text for search is read in the background after an import — about 8 seconds for
8.04's 148 PDFs — so a course opens immediately and its search results fill in. Progress
is saved per file, so an interrupted run picks up where it stopped.

MathJax and pdf.js's support files are copied into `public/vendor` by `npm run vendor`
(run automatically before `dev` and `build`), so nothing is fetched from a CDN and both
work offline.

## How an OCW archive is read

A downloaded OCW course is an offline copy of the published Hugo site. Two things make it
machine-readable rather than something to scrape:

- OCW's Hugo config declares `coursedata` and `contentmap` output formats, so the site
  publishes a `data.json` beside **every** page (front-matter params merged with rendered
  content) and a `content_map.json` mapping every content uid to its path.
- Ordering and nesting are *not* in that JSON — Hugo keeps menu definitions out of page
  params — but the rendered sidebar carries `data-uuid` on every entry.

So content comes from JSON and structure comes from the rendered nav. Archives without the
JSON outputs fall back to HTML parsing; pre-2022 IMS packages are detected and reported
rather than guessed at.

Videos are excluded from OCW archives, but each video resource carries its YouTube id, so
lecture video works without shipping any media.

## License

Code is MIT. Course content is not redistributed by this project — it stays on your machine.
MIT OpenCourseWare materials are licensed CC BY-NC-SA; the reader displays each course's
attribution and license.
