# open-ed-web

Read MIT OpenCourseWare course archives as structured, mastery-tracked courses.

Everything runs in the browser. A course `.zip` never leaves your machine: it is stored
once in the browser's private file system and read by random access, so a 250 MB course
costs one write and no unpacking. Your progress lives in a portable `progress.json` you
can export, back up, or keep in a synced folder — there is no server and no database to run.

## Status

Working end to end: import an archive, read the course, rate what you have read, and
review what is due. Search, PDF text extraction and offline install are still to come.

## Development

```
npm install
npm run dev
npm test                      # unit tests (fixtures are generated automatically)
npm run verify                # typecheck, build, size budget, unit tests
CHROMIUM_PATH=/path/to/chrome npm run e2e   # browser tests
```

The initial payload has a 150 KB gzipped budget, enforced by `npm run size` in CI. Nearly
everything is lazily loaded: the archive reader, the content database, the scheduler and
the HTML parser all stay out of the first load.

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
