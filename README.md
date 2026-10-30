# open-ed-web

Study MIT OpenCourseWare courses as structured, mastery-tracked courses: in the browser,
as a desktop app, or both, with your progress kept in step across devices.

You download a course from [ocw.mit.edu](https://ocw.mit.edu) as a `.zip` and import it.
The app keeps its own copy, so you can delete the download. The copy is stored once and
read in place, with nothing unpacked, so a 250 MB course costs one write. Your progress lives in a portable `progress.json`. You can
export it, keep it in a folder you choose, or sync it between devices. Sync is end-to-end
encrypted, so the server only ever holds data it cannot read.

## Features

- **Dashboard**: reviews due, your streak, materials finished, overall mastery, a two-week
  activity chart, and "continue where you left off".
- **Reader**: follows the course's own sidebar, with breadcrumbs, previous/next in study
  order (`p` / `n`) and a drawer on small screens.
- **The same sections in every course** (Syllabus, Lecture notes, Assignments with
  their solutions, Exams…), built from OCW's own tags, so things are always in the same
  place.
- **Tidied pages**: the importer repairs common faults in OCW's published HTML and names
  materials that were titled with a file name. Checked against 22 courses picked at
  random from OCW's catalogue.
- **PDF viewer** built on pdf.js: themed toolbar, zoom and fit to width, selectable text,
  a dimmed mode for night reading. It remembers your page.
- **Math** typeset by MathJax, including spoken equations for screen readers.
- **Videos** from YouTube via the ids the archive carries, with transcripts from the archive.
- **Mastery**: spaced repetition (FSRS) from your own ratings and OCW's quiz questions, with
  one review queue across every course.
- **Search** across every course, including the full text of every PDF and transcript.
  Press `/` anywhere.
- **Sync** between devices with a link or QR code. There are no accounts, and progress is
  encrypted on the device before it leaves it.
- **A course library** that follows you: import a course on one device and your others
  download it straight from MIT by themselves. The server only keeps the list.
- **Automatic updates** for the desktop app, signed and verified.
- **Desktop app** for Windows, macOS and Linux, from the same code.
- **Light and dark** themes.

## Getting started

| I want to… | Read |
| --- | --- |
| Use the app: import a course, study, review, sync | [docs/user-guide.md](docs/user-guide.md) |
| Host my own copy: Cloudflare, Vercel, Docker or any server | [docs/self-hosting.md](docs/self-hosting.md) |
| Install or build the desktop app, or cut a release | [docs/desktop.md](docs/desktop.md) |
| Understand how sync works and what the server can see | [docs/sync.md](docs/sync.md) |

The quickest way to your own instance with sync is the Cloudflare free tier:

```sh
git clone https://github.com/<you>/open-ed-web && cd open-ed-web
npm install
npx wrangler@4 login
npx wrangler@4 d1 create open-ed-web   # paste the database_id into wrangler.jsonc
npm run deploy:cloudflare
```

## Development

Requires Node 20.19 or newer (22 recommended). The desktop app also needs Rust; see
[docs/desktop.md](docs/desktop.md).

```sh
npm install
npm run dev                   # the web app on http://localhost:5173
npm test                      # unit tests (fixtures are generated automatically)
npm run verify                # typecheck, build, size budget, unit tests
npm run e2e                   # browser tests against the self-hosted server
npm run build:server && npm start   # web app + sync API on http://localhost:8787
npm run desktop:dev           # the desktop app, with hot reload
OCW_ARCHIVE=/path/to/course.zip npx vitest run real-archive   # parse a real download
OCW_SURVEY_DIR=/path/to/zips npx vitest run survey      # check the importer against many courses
```

Set `CHROMIUM_PATH` to use an existing Chrome for the browser tests, and `E2E_BASE_URL`
to run them against another deployment, such as `wrangler dev` or a preview URL.

### Layout

| Path | What |
| --- | --- |
| `src/` | The web app (Vite, React 19, TanStack Router) |
| `src/import/` | Reads OCW archives into courses; `tidy.ts` and `titles.ts` repair them |
| `src/sync/` | Client side of sync: encryption, the sync loop, pairing UI |
| `src/library/` | The course library, and downloading courses from OCW |
| `src/updates/` | Desktop auto-update |
| `server/` | The sync API, written once against web-standard `Request`/`Response` |
| `server/cloudflare.ts`, `api/sync.ts`, `server/node.ts` | Host adapters: Cloudflare Workers, Vercel, Node |
| `src-tauri/` | The desktop shell (Tauri 2) |
| `.github/workflows/` | CI, and the release workflow that builds installers |

### Staying light

The first load is about 137 KB of JavaScript and CSS, gzipped, against a 150 KB budget
that CI enforces with `npm run size`. Everything heavy loads only when a page needs it:

| Loaded when | What | Size (gzipped) |
| --- | --- | --- |
| A course is opened | archive reader, content database | ~90 KB |
| A PDF is opened | pdf.js, plus its worker (cached after) | ~150 KB + ~380 KB |
| Search is used | search worker with MiniSearch | ~35 KB |
| A page contains math | MathJax with fonts | ~600 KB |
| Sync is turned on | sync engine (QR code: ~8 KB more, when shown) | ~2 KB |
| Text is shown | two variable fonts, only the faces and scripts used | ~35–90 KB |

PDF text for search is read in the background after an import. For 8.04's 148 PDFs that
takes about 8 seconds, so a course opens immediately and its search results fill in.

MathJax and pdf.js's support files are copied into `public/vendor` by `npm run vendor`,
which runs automatically before `dev` and `build`. Nothing is fetched from a CDN, so both
work offline.

## How an OCW archive is read

A downloaded OCW course is an offline copy of the published Hugo site. Two things make it
machine-readable, so nothing has to be scraped:

- OCW's Hugo config declares `coursedata` and `contentmap` output formats, so the site
  publishes a `data.json` beside **every** page and a `content_map.json` mapping every
  content uid to its path.
- Ordering and nesting are *not* in that JSON, but the rendered sidebar carries
  `data-uuid` on every entry.

So content comes from JSON and structure comes from the rendered nav. A course is
identified by OCW's own `site_uid`, so the same course has the same id on every device,
which is what lets synced progress find its course. Pre-2022 IMS packages are detected and
reported, not guessed at.

## License

Code is MIT (see [LICENSE](LICENSE)). Course content is not redistributed by this project:
it stays on your device. MIT OpenCourseWare materials are licensed CC BY-NC-SA, and the
reader shows each course's attribution and license. This project is not affiliated with MIT.
