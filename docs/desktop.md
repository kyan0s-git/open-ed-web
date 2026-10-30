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
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | Secrets | Sign the macOS app with a Developer ID certificate (base64 `.p12`). |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Secrets | Notarize it, so Gatekeeper opens it without warnings. `APPLE_PASSWORD` is an app-specific password. |

Without the Apple secrets, the macOS app is ad-hoc signed. It runs once the user allows it,
as described under Installing. Windows code signing needs a certificate from a commercial
authority. Tauri's [Windows signing guide](https://tauri.app/distribute/sign/windows/)
covers the options.

## Known limitations

- **Automatic updates** are not set up. New versions are installed from the Releases page.
  Tauri's updater plugin can be added later; it needs a signing key pair.
- **YouTube videos** may refuse to play inside the app's window, because YouTube restricts
  embeds on pages without a web address. Use **Watch on YouTube**, which opens your
  browser.
- **Choosing a file for progress.json** ("Keep it in a file I choose") is a Chromium
  feature, so it appears only where the engine supports it, which in practice means the
  Windows app. **Export** works everywhere.
