import { lazy, Suspense, useState } from "react";
import { Icon } from "@/ui/icons";
import { isDesktopApp } from "@/desktop";
import { defaultServer, parseSyncLink } from "./config";
import { syncEngine } from "./engine";
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

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}
