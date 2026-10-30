import { Icon } from "@/ui/icons";
import { formatBytes } from "@/content/ResourceView";
import {
  APP_VERSION,
  checkForUpdate,
  download,
  restartToUpdate,
  setAutoUpdate,
  updatesAvailable,
  useUpdates,
} from "./updates";

/** A slim bar under the top bar when an update is waiting for the learner. */
export function UpdateBanner() {
  const { state, offered, settings } = useUpdates();
  if (state.kind === "ready") {
    return (
      <div className="updatebar" role="status">
        <span>Version {state.version} is ready.</span>
        <button className="btn" type="button" onClick={() => void restartToUpdate()}>
          <Icon name="review" /> Restart to update
        </button>
      </div>
    );
  }
  if (state.kind === "idle" && offered && !settings.auto) {
    return (
      <div className="updatebar" role="status">
        <span>Version {offered} is available.</span>
        <button className="btn" type="button" onClick={() => void download()}>
          <Icon name="download" /> Download
        </button>
      </div>
    );
  }
  return null;
}

/** Settings section: current version, automatic updates, check now. */
export function UpdateSettings() {
  const { state, settings, offered } = useUpdates();
  if (!updatesAvailable()) {
    return (
      <p className="muted" style={{ margin: 0, fontSize: "var(--step--1)" }}>
        open-ed-web {APP_VERSION}.
      </p>
    );
  }

  const status =
    state.kind === "checking"
      ? "Checking for updates…"
      : state.kind === "downloading"
        ? `Downloading ${state.version}… ${state.total ? `${Math.round((state.done / state.total) * 100)}%` : formatBytes(state.done)}`
        : state.kind === "ready"
          ? `Version ${state.version} is downloaded and installs when the app restarts.`
          : state.kind === "error"
            ? `Could not check for updates: ${state.message}`
            : offered
              ? `Version ${offered} is available.`
              : state.checkedAt
                ? "You have the latest version."
                : null;

  return (
    <section className="section stack">
      <h2 style={{ margin: 0 }}>Updates</h2>
      <p style={{ margin: 0 }}>
        You are running open-ed-web {APP_VERSION}. {status}
      </p>
      <label className="check">
        <input type="checkbox" checked={settings.auto} onChange={(event) => setAutoUpdate(event.target.checked)} />
        <span>
          <strong>Download updates automatically</strong>
          <small>New versions download in the background and install when you restart the app. Updates are signed and verified before they install.</small>
        </span>
      </label>
      <div className="row">
        {state.kind === "ready" ? (
          <button className="btn" type="button" onClick={() => void restartToUpdate()}>
            Restart to update
          </button>
        ) : (
          <button
            className="btn btn--quiet"
            type="button"
            disabled={state.kind === "checking" || state.kind === "downloading"}
            onClick={() => void (offered && state.kind === "idle" ? download() : checkForUpdate())}
          >
            {offered && state.kind === "idle" ? "Download update" : "Check for updates"}
          </button>
        )}
      </div>
    </section>
  );
}
