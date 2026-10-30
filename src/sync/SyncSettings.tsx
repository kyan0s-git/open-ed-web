import { lazy, Suspense, useEffect, useState } from "react";
import { Icon } from "@/ui/icons";
import { isDesktopApp } from "@/desktop";
import { defaultServer, parseSyncLink } from "./config";
import { syncEngine, type CourseStorage } from "./engine";
import { formatBytes } from "@/content/ResourceView";
import { useSyncStatus } from "./useSync";

const QrCode = lazy(() => import("./QrCode").then((m) => ({ default: m.QrCode })));

/** Settings panel for syncing progress between devices. */
export function SyncSettings() {
  const status = useSyncStatus();
  return (
    <section className="section stack">
      <h2 style={{ margin: 0 }}>Sync across devices</h2>
      {status.state === "off" ? <TurnOn /> : <Connected />}
    </section>
  );
}

function TurnOn() {
  const [server, setServer] = useState(defaultServer);
  const [link, setLink] = useState("");
  const [mode, setMode] = useState<"choose" | "join">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Keep your progress the same on every computer and phone you use. It is encrypted on this device before it
        is uploaded, so the sync server stores only data it cannot read. Course files are not synced; import each
        course on each device.
      </p>

      {mode === "choose" ? (
        <>
          <label className="field">
            <span>Sync server</span>
            <input
              type="url"
              value={server}
              placeholder="https://your-site.example"
              onChange={(event) => setServer(event.target.value)}
              spellCheck={false}
            />
          </label>
          {!server && isDesktopApp() && (
            <p className="muted" style={{ margin: 0 }}>
              Enter the address of your open-ed-web site, or connect with a sync link from another device.
            </p>
          )}
          <div className="row">
            <button className="btn" type="button" disabled={busy || !server.trim()} onClick={() => act(() => syncEngine.create(server))}>
              <Icon name="sync" /> Turn on sync
            </button>
            <button className="btn btn--quiet" type="button" onClick={() => setMode("join")}>
              I have a sync link
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="field">
            <span>Sync link from your other device</span>
            <textarea
              rows={3}
              value={link}
              placeholder="https://…/pair#k=…"
              onChange={(event) => setLink(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="row">
            <button
              className="btn"
              type="button"
              disabled={busy || !link.trim()}
              onClick={() => act(() => syncEngine.join(parseSyncLink(link)))}
            >
              <Icon name="sync" /> Connect this device
            </button>
            <button className="btn btn--quiet" type="button" onClick={() => setMode("choose")}>
              Back
            </button>
          </div>
        </>
      )}

      {busy && <p className="muted" role="status">Connecting…</p>}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function Connected() {
  const status = useSyncStatus();
  const [showLink, setShowLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = syncEngine.link;
  const host = status.server ? new URL(status.server).host : "";

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const remove = async () => {
    if (!confirm("Delete your synced progress from the server? Every device keeps its own copy, but they will stop syncing.")) return;
    try {
      await syncEngine.deleteVault();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <>
      <p className="syncstate" data-state={status.state} role="status">
        <span className="syncstate__dot" aria-hidden="true" />
        {status.state === "syncing"
          ? `Syncing with ${host}…`
          : status.state === "error"
            ? `Not synced: ${status.error}`
            : status.lastSyncedAt
              ? `Synced with ${host} ${relativeTime(status.lastSyncedAt)}.`
              : `Connected to ${host}.`}
      </p>

      <div className="row">
        <button className="btn" type="button" disabled={status.state === "syncing"} onClick={() => void syncEngine.syncNow().catch(() => {})}>
          <Icon name="sync" /> Sync now
        </button>
        <button className="btn btn--quiet" type="button" aria-expanded={showLink} onClick={() => setShowLink(!showLink)}>
          <Icon name="plus" /> Add another device
        </button>
      </div>

      {showLink && link && (
        <div className="card card--pad pairing">
          <Suspense fallback={<div className="qr" />}>
            <QrCode text={link} label="QR code of the sync link" />
          </Suspense>
          <div className="stack" style={{ gap: "0.6rem" }}>
            <p style={{ margin: 0 }}>
              Scan this with your phone's camera, or open the link on your other device. In the desktop app, paste it
              under <strong>I have a sync link</strong>.
            </p>
            <code className="pairing__link">{link}</code>
            <div className="row">
              <button className="btn btn--quiet" type="button" onClick={() => void copy()}>
                {copied ? <Icon name="check" /> : <Icon name="copy" />} {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: "var(--step--1)" }}>
              Anyone with this link can read and change your progress. Share it only with your own devices.
            </p>
          </div>
        </div>
      )}

      <CourseStorageSettings />

      <details className="danger">
        <summary>Stop syncing</summary>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button className="btn btn--quiet" type="button" onClick={() => syncEngine.disconnect()}>
            Turn off on this device
          </button>
          <button className="btn btn--quiet" type="button" onClick={() => void remove()}>
            Delete synced data from the server
          </button>
        </div>
        <p className="muted" style={{ fontSize: "var(--step--1)" }}>
          Either way, the progress on this device stays here.
        </p>
      </details>

      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const DOWNLOAD_LIMITS = [
  { value: 100, label: "Up to 100 MB" },
  { value: 250, label: "Up to 250 MB" },
  { value: 500, label: "Up to 500 MB" },
  { value: 0, label: "Any size" },
];

/**
 * Storing course archives on the sync server, so other devices can download a course
 * instead of importing its .zip again. Off by default on every device, and offered only
 * when the server has it turned on.
 */
function CourseStorageSettings() {
  useSyncStatus(); // re-render when the settings change
  const settings = syncEngine.courseSettings;
  const [storage, setStorage] = useState<CourseStorage | null | undefined>(undefined);
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number } | null>(null);

  useEffect(() => {
    let live = true;
    syncEngine
      .courseStorage()
      .then((value) => live && setStorage(value))
      .catch(() => live && setStorage(null));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!storage || !settings.enabled) return;
    let live = true;
    void import("./library").then(({ storageUsage }) => storageUsage()).then((value) => live && setUsage(value));
    return () => {
      live = false;
    };
  }, [storage, settings.enabled]);

  if (storage === undefined) return null;

  if (storage === null) {
    return (
      <p className="muted" style={{ margin: 0, fontSize: "var(--step--1)" }}>
        This sync server stores progress only. Its operator can turn on course storage so devices can download
        courses from it; see the self-hosting guide.
      </p>
    );
  }

  const set = (change: Partial<typeof settings>) => {
    syncEngine.setCourseSettings(change);
    if (change.enabled || change.autoDownload) {
      void import("./library").then(({ startAutoDownload }) => startAutoDownload());
    }
  };

  return (
    <fieldset className="options">
      <legend>Courses on the server</legend>
      <label className="check">
        <input type="checkbox" checked={settings.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
        <span>
          <strong>Store courses on the sync server</strong>
          <small>
            Your other devices can then download a course instead of importing its .zip. Courses are encrypted
            like your progress, and sent in {formatBytes(storage.chunkBytes)} pieces, so an interrupted upload
            picks up where it stopped.
          </small>
        </span>
      </label>

      {settings.enabled && (
        <div className="options__more">
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoUpload}
              onChange={(event) => set({ autoUpload: event.target.checked })}
            />
            <span>
              <strong>Upload courses I import on this device</strong>
              <small>Otherwise, upload each one from the list of stored courses below.</small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoDownload}
              onChange={(event) => set({ autoDownload: event.target.checked })}
            />
            <span>
              <strong>Download courses my other devices store</strong>
              <small>Otherwise, download them from the Courses page when you want them.</small>
            </span>
          </label>
          {settings.autoDownload && (
            <label className="field field--inline">
              <span>Download automatically</span>
              <select
                className="select"
                value={settings.autoDownloadMaxMB}
                onChange={(event) => set({ autoDownloadMaxMB: Number(event.target.value) })}
              >
                {DOWNLOAD_LIMITS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {usage && (
            <p className="muted" style={{ margin: 0, fontSize: "var(--step--1)" }}>
              Using {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)} on the server.
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}
