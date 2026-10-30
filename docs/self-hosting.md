# Hosting your own open-ed-web

open-ed-web has two parts:

- **The web app**: static files built into `dist/`. Any static host can serve it.
- **The sync API**: a small service that stores one encrypted blob per sync vault. It is
  needed only for syncing between devices. Without it, the app works fully on each device
  on its own.
- **Course storage** (optional, off unless you turn it on): lets devices upload the
  courses they import, so other devices can download them instead of importing the `.zip`
  again. It needs a blob store: R2 on Cloudflare, Vercel Blob on Vercel, or the disk on
  your own server. See [Course storage](#course-storage-optional).

The API is written once (`server/core.ts`) against standard `Request`/`Response`
objects. Each host gets a thin adapter, and they all serve the web app and the API from
one address:

| Host | Storage | Cost for personal use | Setup |
| --- | --- | --- | --- |
| [Cloudflare Workers](#cloudflare-workers-recommended) (recommended) | D1 (SQLite) | Free tier | One config file, one command |
| [Vercel](#vercel) | Upstash Redis | Free tiers | Import repo, add Redis |
| [Docker or Node](#docker-or-node-on-your-own-server) | Files on disk (or Redis) | Your server | One container |
| [Static only](#static-hosting-without-sync) | — | Free almost anywhere | Upload `dist/` |

Whichever you choose, the site must be served over **HTTPS** (or `localhost`). Browsers
only allow the storage APIs the app depends on in a secure context.

## Cloudflare Workers (recommended)

The Worker serves `dist/` as static assets and runs only for `/api/*`. Vaults live in a
D1 database. The table is created automatically on first use, so there are no migrations
to run.

1. Fork or clone this repository, then install:

   ```sh
   npm install
   npx wrangler@4 login
   ```

2. Create the database and copy the `database_id` it prints into `wrangler.jsonc`, in
   place of `REPLACE_WITH_YOUR_DATABASE_ID`:

   ```sh
   npx wrangler@4 d1 create open-ed-web
   ```

3. Build and deploy:

   ```sh
   npm run deploy:cloudflare
   ```

   Wrangler prints your address, such as `https://open-ed-web.<account>.workers.dev`.
   Open it, go to **Settings → Sync across devices**, and turn sync on.

To use your own domain, add it under the Worker's **Settings → Domains & Routes** in the
Cloudflare dashboard. To deploy on every push, connect the repository under **Workers &
Pages → your Worker → Settings → Build** with the build command `npm run build` and the
deploy command `npx wrangler@4 deploy`.

You can change the name in `wrangler.jsonc` (`"name"`), and the database name to match.
Without the `d1_databases` block the site still deploys, and sync reports that it is
unavailable.

To try the Worker locally with a local D1 database: `npm run build && npx wrangler@4 dev`.

## Vercel

Vercel serves `dist/` and runs `api/sync.ts` as a Function. Vercel has no built-in
key-value store, so vaults go in Upstash Redis from the Vercel Marketplace.

1. Import the repository in Vercel (**Add New → Project**). `vercel.json` already sets the
   build command, the output directory and the routing, so accept the defaults.
2. In the project, open **Storage → Create Database → Upstash → Redis**. Create it and
   connect it to the project. This adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   environment variables, which the function reads. (`UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` also work, if you use an Upstash database directly.)
3. Redeploy so the function picks up the variables.

## Docker or Node, on your own server

`server/node.ts` serves the web app and the API on one port and keeps vaults as files.

**Docker:**

```sh
docker build -t open-ed-web .
docker run -d --name open-ed-web -p 8787:8787 -v open-ed-web-data:/data --restart unless-stopped open-ed-web
```

Each release also publishes an image to the GitHub Container Registry, as
`ghcr.io/<owner>/<repo>:latest`.

**Plain Node (22 or newer):**

```sh
npm ci
npm run build
npm run build:server
DATA_DIR=/var/lib/open-ed-web npm start
```

The server bundle has no runtime dependencies. Each release attaches
`open-ed-web-<version>-server.tar.gz`, holding `dist/` and `server-dist/`, which runs with
`node server-dist/node.mjs` and no `npm install`.

**HTTPS.** Put a reverse proxy in front. With [Caddy](https://caddyserver.com), which
gets certificates automatically, the whole configuration is:

```
learn.example.com {
	reverse_proxy localhost:8787
}
```

A Cloudflare Tunnel or Tailscale Funnel works too, if the machine is not reachable from
the internet.

Run one server process per data directory: the file store serialises writes within a
process. To run several instances, point them all at Redis (`UPSTASH_REDIS_REST_URL`
and `UPSTASH_REDIS_REST_TOKEN`) instead.

## Static hosting, without sync

`npm run build` produces a static site in `dist/` (each release also attaches it as
`open-ed-web-<version>-web.zip`). GitHub Pages, Netlify, an S3 bucket or any web server
can host it. It needs one rule: unknown paths serve `index.html`, because the app routes
on the client.

To host the app below a path, such as `https://you.github.io/open-ed-web/`, build with
`npx vite build --base=/open-ed-web/`.

A static-only site can still sync through a sync API hosted elsewhere. Build with
`VITE_SYNC_SERVER=https://your-sync-api.example npm run build` to make that server the
default.

## Course storage (optional)

With course storage on, a device can upload a course it imported, and the others in the
same sync vault can download it from **Courses → On your sync server**. Users still choose
per device, in **Settings → Sync across devices → Courses on the server**; the server
only makes it possible.

Courses travel in chunks (4 MB by default), so any host's request limit is fine. They
are encrypted on the device like progress, and named by a keyed hash of their contents.
An interrupted upload resumes, and a course already on the server is not sent again.
Each vault has a quota (5 GB by default). For scale, 8.04 Quantum Physics I is 30 MB, and
large courses run to a few hundred MB.

**Cloudflare:** enable R2 in the dashboard (it asks for a payment method, but the first
10 GB a month are free), then create a bucket and bind it as `BLOBS` by uncommenting the
`r2_buckets` block in `wrangler.jsonc`:

```sh
npx wrangler@4 r2 bucket create open-ed-web-courses
npm run deploy:cloudflare
```

**Vercel:** under **Storage**, create a **Blob** store and connect it to the project.
Vercel sets `BLOB_READ_WRITE_TOKEN`, and the function picks it up on the next deploy.
Chunks are stored as private blobs. Vercel's 4.5 MB body limit caps chunks at 4 MB there.

**Docker or Node:** set `COURSE_STORAGE=on`. Courses go in `DATA_DIR/courses`:

```sh
docker run -d -p 8787:8787 -v open-ed-web-data:/data -e COURSE_STORAGE=on open-ed-web
```

Behind nginx, raise its 1 MB default: `client_max_body_size 8m;`. Caddy has no limit.

To turn it off again on any host, set `COURSE_STORAGE=off`. Courses already stored stay
in the bucket until you delete them, and devices stop offering uploads and downloads.

## Configuration

These environment variables work the same way on every host. On Cloudflare they go in
`vars` in `wrangler.jsonc`, on Vercel under **Settings → Environment Variables**, and for
Docker as `-e NAME=value`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SYNC_ALLOWED_ORIGINS` | `*` | Comma-separated origins that may call the API from a browser. Requests authenticate with a token, not cookies, so `*` is safe. To narrow it, include your site and the desktop app's origins: `tauri://localhost` (macOS, Linux) and `http://tauri.localhost` (Windows). |
| `SYNC_MAX_BYTES` | `1048576` | Largest accepted vault, in bytes. A heavily used progress file compresses to tens of KB. |
| `COURSE_STORAGE` | off on Node, on when a bucket is bound elsewhere | `on` enables course storage on the Node server; `off` disables it on any host. |
| `COURSE_QUOTA_BYTES` | `5368709120` (5 GB) | Course storage allowed per vault. |
| `COURSE_CHUNK_BYTES` | `4194304` (4 MB) | Size of each uploaded piece. Lower it behind proxies with small body limits; Vercel caps it at 4 MB. |
| `SYNC_KEY_PREFIX` | `openedweb:vault:` | Redis key prefix, so a database can be shared. |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Node server only. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Node server only. Where vaults (and, with course storage, courses) go. `memory` keeps them in RAM. |
| `STATIC_DIR` | `./dist` | Node server only. Set it to an empty value to serve only the API. |

Build-time variables, for the web app and desktop app:

| Variable | Meaning |
| --- | --- |
| `VITE_SYNC_SERVER` | Default sync server shown in Settings. Only needed when the app and the API are on different addresses, or for the desktop app. |

## What your server stores, and what it costs

Each vault is one row or file: a random id, a hash of its access token, a version number,
a timestamp, and the encrypted progress, typically 5–50 KB. With course storage on, it
also has encrypted chunks of the courses its devices uploaded. Which courses they are is
recorded only inside the encrypted progress, so the server cannot tell. There are no accounts, emails
or IP logs in the app's own storage. Your host may keep request logs of its own. See
[sync.md](sync.md) for the full design.

A device makes about one request when it opens, one every five minutes while it is in
use, and one or two a few seconds after you finish something. That fits comfortably in
the free tiers of Cloudflare (100,000 Worker requests a day) and Upstash.

## Checking a deployment

The browser tests can run against any deployment:

```sh
npm run fixtures
E2E_BASE_URL=https://your-site.example npx playwright test
```

They import a small generated course, read it, rate it, search it, and sync it between
two simulated devices through your server. They create one sync vault on your server.
Delete it afterwards from **Settings → Stop syncing** if you like.

`GET /api/v1/health` answers `{"ok":true,"service":"open-ed-web-sync",…}` when the API
is up and configured. Its `courses` field is `null` without course storage, or shows the
chunk size and quota with it.
