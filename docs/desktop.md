# The desktop app

The desktop app is the same web app in a native window, built with [Tauri 2](https://tauri.app).
It uses the system's own web engine (WebView2 on Windows, WebKit on macOS and Linux), so
installers are a few megabytes rather than a bundled browser. Everything works offline.
Sync, if you turn it on, talks to whichever sync server you choose.

## Installing

Download the installer for your system from the repository's **Releases** page:

| System | File |
| --- | --- |
| Windows | `open-ed-web_<version>_x64-setup.exe` (or the `.msi`) |
| macOS, Apple Silicon | `open-ed-web_<version>_aarch64.dmg` |
| macOS, Intel | `open-ed-web_<version>_x64.dmg` |
| Linux | `.AppImage` (any distribution), `.deb` (Debian, Ubuntu), `.rpm` (Fedora) |

Releases are unsigned unless whoever publishes them adds signing certificates, as
described below. On first launch:

- **Windows** may show "Windows protected your PC". Choose **More info → Run anyway**.
- **macOS** may refuse to open an app from an unidentified developer. Right-click the app
  in Applications, choose **Open**, and confirm. On recent macOS versions, open
  **System Settings → Privacy & Security** after the first attempt and choose **Open Anyway**.
- **Linux AppImage**: make it executable first (`chmod +x open-ed-web_*.AppImage`).

On Linux, video playback uses GStreamer. The `.deb` installs the codecs it needs, and the
AppImage bundles them. With the `.rpm`, install `gstreamer1-plugins-good`,
`gstreamer1-plugins-bad-free` and your distribution's GStreamer libav plugin if videos say
your browser cannot play them.

## Updates

When a release is set up for it (see [Automatic updates](#automatic-updates) below), the
app checks for a new version shortly after it starts and every few hours. It downloads
the update in the background, checks its signature, and shows **Restart to update**. Your
progress is saved before it restarts. **Settings → Updates** shows the version you have,
has **Check for updates**, and lets you turn off automatic downloads, in which case the
app asks first.

Updates apply to the Windows installers, the macOS app, and the Linux AppImage. The
`.deb` and `.rpm` packages are updated by installing the new package.

## Moving to a new computer

Your `progress.json` holds your progress and your course library: the list of courses
you have, with where each can be downloaded. To move without sync, use **Settings →
Export progress.json** on the old computer and **Import and merge** on the new one. The
new computer then downloads your OCW courses from ocw.mit.edu by itself. With sync on,
connecting the new computer does the same.

## Syncing with your other devices

The desktop app has no web address of its own, so it needs to be told where your sync
server is. Either:

- on a device that already syncs, open **Settings → Sync across devices → Add another
  device**, copy the link, and paste it into the desktop app under **I have a sync link**.
  The link carries the server address. Or,
- type your site's address (for example `https://open-ed-web.you.workers.dev`) in
  **Sync server** and choose **Turn on sync**.

Builds can include a default server (see `SYNC_SERVER_URL` below), in which case the field
is filled in already.

## Where data lives

Like the browser version, the app keeps course archives and `progress.json` in the
webview's storage, inside the app's data folder. That is typically:

| System | Folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\org.openedweb.desktop` |
| macOS | `~/Library/WebKit/org.openedweb.desktop` and `~/Library/Application Support/org.openedweb.desktop` |
| Linux | `~/.local/share/org.openedweb.desktop` |

Uninstalling the app may leave this folder behind. Use **Settings → Export
progress.json** to keep a copy of your progress anywhere you like.

## Building it yourself

Prerequisites (see Tauri's [prerequisites guide](https://tauri.app/start/prerequisites/)
for details):

- Node 20.19+ and Rust (stable, via [rustup](https://rustup.rs)).
- **Linux:** `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential`
  (or your distribution's equivalents).
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** Microsoft C++ Build Tools and WebView2, which Windows 10 and 11 already have.

Then:

```sh
npm install
npm run desktop:dev     # a window running the dev server, with hot reload
npm run desktop:build   # installers in src-tauri/target/release/bundle/
```

To bake in a default sync server: `VITE_SYNC_SERVER=https://your-site.example npm run desktop:build`.

### Making it your own

If you publish your own builds, change these first:

- `identifier` in `src-tauri/tauri.conf.json` (`org.openedweb.desktop`). This
  reverse-domain id must be unique to you. It also names the data folder, so changing it
  later means the app starts with empty storage.
- `productName` there, and the window title, if you rename the app.
- The icon: edit `src-tauri/app-icon.svg`, render it to a 1024×1024 PNG, and run
  `npx tauri icon that.png -o src-tauri/icons`.

## Releasing

`.github/workflows/release.yml` builds and publishes everything when you push a version tag:

```sh
npm version 0.2.0 --no-git-tag-version     # updates package.json and package-lock.json
git commit -am "Release 0.2.0"
git tag v0.2.0
git push --follow-tags
```

The workflow:

1. checks the tag matches `package.json` and creates a draft GitHub Release with
   generated notes;
2. builds the web app and the self-hosted server, and attaches them as
   `open-ed-web-<version>-web.zip` and `open-ed-web-<version>-server.tar.gz`;
3. builds desktop installers on Windows, macOS (Apple Silicon and Intel) and Linux, and
   attaches them;
4. publishes the release once all of that succeeded.

If a step fails, fix it and re-run the failed jobs. You can also start the workflow from
the **Actions** tab for an existing tag. The desktop version comes from `package.json`,
so there is only one place to bump.

The workflow needs nothing beyond the repository's own `GITHUB_TOKEN`, with
**Settings → Actions → General → Workflow permissions** set to read and write so it can
create the release.

### Optional settings

Under **Settings → Secrets and variables → Actions**:

| Name | Kind | Effect |
| --- | --- | --- |
| `SYNC_SERVER_URL` | Variable | Default sync server in the desktop app. |
| `TAURI_UPDATER_PUBKEY` | Variable | Turns on automatic updates; the public half of your update key. |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secrets | The private half and its password, used to sign each release's updates. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | Secrets | Sign the macOS app with a Developer ID certificate (base64 `.p12`). |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Secrets | Notarize it, so Gatekeeper opens it without warnings. `APPLE_PASSWORD` is an app-specific password. |

### Automatic updates

Updates are signed with a key only you hold, and the app installs nothing that key did
not sign. To turn them on, create the key once:

```sh
npx tauri signer generate -w ~/.tauri/open-ed-web.key
```

Then, under **Settings → Secrets and variables → Actions**, add:

- the contents of `~/.tauri/open-ed-web.key` as the secret `TAURI_SIGNING_PRIVATE_KEY`,
  and its password as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`;
- the contents of `~/.tauri/open-ed-web.key.pub` as the variable `TAURI_UPDATER_PUBKEY`.

From the next release on, the workflow signs every installer, publishes `latest.json`
with the release, and builds the app to check
`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`. Keep the
private key backed up: if it is lost, installed apps cannot verify updates signed with a
new one, and their users must reinstall once. Releases made without the key build apps
that do not check for updates at all. The same applies to forks and local builds.

### Code signing

Without the Apple secrets, the macOS app is ad-hoc signed. It runs once the user allows it,
as described under Installing. Windows code signing needs a certificate from a commercial
authority. Tauri's [Windows signing guide](https://tauri.app/distribute/sign/windows/)
covers the options.

## Known limitations

- **YouTube** refuses embeds from pages without a web address (error 153), and the app's
  pages have none on macOS and Linux. So the app serves a one-page video host on
  `127.0.0.1` (`src-tauri/src/video.rs`) that embeds the player from an ordinary web
  origin. It listens only on the local machine and only serves that page. If YouTube still
  will not play a video, **YouTube** opens it in your browser.
- **Choosing a file for progress.json** ("Keep it in a file I choose") is a Chromium
  feature, so it appears only where the engine supports it, which in practice means the
  Windows app. **Export** works everywhere.
