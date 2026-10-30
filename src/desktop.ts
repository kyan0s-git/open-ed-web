/**
 * The few places the desktop app (Tauri) differs from a browser.
 *
 * The app is the same build either way; these helpers check at runtime. Desktop
 * webviews do not open target=_blank links or save <a download> files on their own,
 * so both are routed to the native side: links to the system browser, downloads to a
 * save dialog (see src-tauri/src/lib.rs).
 */

interface TauriInternals {
  invoke<T>(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<T>;
}

function tauri(): TauriInternals | null {
  return typeof window !== "undefined"
    ? ((window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__ ?? null)
    : null;
}

export function isDesktopApp(): boolean {
  return tauri() !== null;
}

/** Save a file: a native save dialog on desktop, a download in the browser. */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  const native = tauri();
  if (native) {
    await native.invoke("save_file", new Uint8Array(await blob.arrayBuffer()), {
      headers: { "x-file-name": encodeURIComponent(name) },
    });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openExternal(url: string): void {
  const native = tauri();
  if (native) void native.invoke("plugin:opener|open_url", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** On desktop, send external links to the browser and downloads to a save dialog. */
export function installDesktopHandlers(): void {
  if (!isDesktopApp()) return;
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      if (anchor.hasAttribute("download")) {
        event.preventDefault();
        const name = anchor.getAttribute("download") || anchor.href.split("/").pop() || "download";
        void fetch(anchor.href)
          .then((response) => response.blob())
          .then((blob) => saveFile(blob, name));
        return;
      }

      const url = new URL(anchor.href, location.href);
      if (/^(https?|mailto):$/.test(url.protocol) && url.origin !== location.origin) {
        event.preventDefault();
        openExternal(url.href);
      }
    },
    true,
  );
}

let videoBase: Promise<string | null> | null = null;

/**
 * Where the desktop app hosts YouTube embeds (see src-tauri/src/video.rs), or null in a
 * browser, where the page's own origin already gives YouTube the referrer it requires.
 */
export function desktopVideoBase(): Promise<string | null> {
  const native = tauri();
  if (!native) return Promise.resolve(null);
  videoBase ??= native.invoke<string | null>("video_embed_base").catch(() => null);
  return videoBase;
}
