import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { parseSyncLink, readSyncConfig } from "@/sync/config";
import { syncEngine } from "@/sync/engine";
import { Icon } from "@/ui/icons";

/**
 * Where a sync link lands: https://…/pair#k=…
 *
 * The secret is read from the fragment once and then removed from the address bar, so it
 * does not linger in history or get copied along with the URL.
 */
export function PairPage() {
  const navigate = useNavigate();
  const [target] = useState(() => {
    try {
      return { ok: true as const, value: parseSyncLink(location.href) };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message };
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (location.hash) history.replaceState(history.state, "", location.pathname);
  }, []);

  const current = readSyncConfig();
  const already = target.ok && current?.secret === target.value.secret;

  const connect = async () => {
    if (!target.ok) return;
    setBusy(true);
    setError(null);
    try {
      await syncEngine.join(target.value);
      await navigate({ to: "/settings" });
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <p className="eyebrow">Sync</p>
      <h1>Connect this device</h1>

      {!target.ok ? (
        <p className="notice notice--error" role="alert">
          {target.error} Open <strong>Settings → Sync across devices → Add another device</strong> on a device that
          already syncs to get a fresh link.
        </p>
      ) : already ? (
        <>
          <p className="lede">This device is already connected to that sync vault.</p>
          <Link to="/settings" className="btn">
            Go to settings
          </Link>
        </>
      ) : (
        <div className="stack">
          <p className="lede">
            Your progress on this device will be merged with the progress synced through{" "}
            <strong>{new URL(target.value.server).host}</strong>, and kept in step from now on. Nothing on either side
            is overwritten: where both have a record, the newer one is kept.
          </p>
          {current && (
            <p className="notice">
              This device currently syncs with a different vault. Connecting switches it to this one; its progress
              comes along.
            </p>
          )}
          <div className="row">
            <button className="btn" type="button" disabled={busy} onClick={() => void connect()}>
              <Icon name="sync" /> {busy ? "Connecting…" : "Connect"}
            </button>
            <Link to="/" className="btn btn--quiet">
              Not now
            </Link>
          </div>
          {error && (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
