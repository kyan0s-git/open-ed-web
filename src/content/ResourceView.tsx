import { useEffect, useState } from "react";
import type { Resource } from "./schema";
import { assetUrl } from "./assets";
import { guessMime } from "./maps";
import { desktopVideoBase } from "@/desktop";
import { Icon } from "@/ui/icons";
import { PdfViewer } from "./PdfViewer";

/**
 * Displays one material.
 *
 * PDFs open in a pdf.js viewer that matches the reader (see PdfViewer). Videos are not
 * shipped in OCW archives, so they play from YouTube using the id the archive carries;
 * the transcript, which is in the archive, opens locally.
 */
export function ResourceView({
  courseId,
  resource,
  page,
  highlight,
}: {
  courseId: string;
  resource: Resource;
  /** From a search: the page of the PDF (or the video's transcript) that matched. */
  page?: number;
  highlight?: string;
}) {
  if (resource.youtubeId) return <VideoView courseId={courseId} resource={resource} page={page} highlight={highlight} />;

  const mime = resource.mime ?? (resource.zipPath ? guessMime(resource.zipPath) : undefined);
  if (resource.zipPath && mime === "application/pdf") {
    return <PdfView courseId={courseId} resource={resource} page={page} highlight={highlight} />;
  }
  if (resource.zipPath && (resource.resourcetype === "Image" || mime?.startsWith("image/"))) {
    return <ImageView courseId={courseId} resource={resource} />;
  }
  if (resource.zipPath) return <FileView courseId={courseId} resource={resource} />;
  return <p className="notice">This material has no file in the archive.</p>;
}

function VideoView({
  courseId,
  resource,
  page,
  highlight,
}: {
  courseId: string;
  resource: Resource;
  page?: number;
  highlight?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [posterFailed, setPosterFailed] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  // Arriving from a transcript search result opens the transcript at the match.
  const [showTranscript, setShowTranscript] = useState(Boolean(page && resource.transcriptPath));
  const transcript = useAssetUrl(courseId, resource.transcriptPath, "application/pdf");
  const id = resource.youtubeId!;

  return (
    <div>
      {playing ? (
        <div className="video">
          <VideoFrame id={id} title={resource.title} />
        </div>
      ) : (
        // A facade until clicked: the YouTube player is a lot of script for a video
        // that may never be watched.
        <button className="video" type="button" onClick={() => setPlaying(true)}>
          {posterFailed ? (
            // Offline, or YouTube's image host is blocked: a poster of our own.
            <span className="video__poster" aria-hidden="true">
              {resource.title}
            </span>
          ) : (
            <img
              src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
              alt=""
              width={480}
              height={360}
              onError={() => setPosterFailed(true)}
            />
          )}
          <span className="video__play">
            <Icon name="play" size={26} />
          </span>
          <span className="sr-only">Play {resource.title}</span>
        </button>
      )}

      <div className="material-actions">
        {transcript && (
          <button
            type="button"
            className="btn btn--quiet"
            aria-expanded={showTranscript}
            onClick={() => setShowTranscript((value) => !value)}
          >
            <Icon name="file" /> {showTranscript ? "Hide transcript" : "Transcript"}
          </button>
        )}
        {resource.archiveUrl && (
          <a className="btn btn--quiet" href={resource.archiveUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="download" /> Download video
          </a>
        )}
        <a
          className="btn btn--quiet"
          href={`https://www.youtube.com/watch?v=${id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="external" /> YouTube
        </a>
      </div>

      {showTranscript && transcript && (
        <div className="related">
          <h2>Transcript</h2>
          <PdfViewer
            url={transcript}
            title={`${resource.title} — transcript`}
            storageKey={`${courseId}:${resource.uid}:transcript`}
            downloadName={`${resource.title} transcript.pdf`}
            initialPage={page}
            highlight={highlight}
          />
        </div>
      )}
    </div>
  );
}

function PdfView({
  courseId,
  resource,
  page,
  highlight,
}: {
  courseId: string;
  resource: Resource;
  page?: number;
  highlight?: string;
}) {
  const url = useAssetUrl(courseId, resource.zipPath, "application/pdf");
  if (!url) return <div className="pdf pdf--empty" />;

  return (
    <PdfViewer
      url={url}
      title={resource.title}
      storageKey={`${courseId}:${resource.uid}`}
      downloadName={fileName(resource)}
      sizeLabel={resource.sizeBytes ? formatBytes(resource.sizeBytes) : undefined}
      initialPage={page}
      highlight={highlight}
    />
  );
}

function ImageView({ courseId, resource }: { courseId: string; resource: Resource }) {
  const url = useAssetUrl(courseId, resource.zipPath);
  if (!url) return null;
  return <img src={url} alt={resource.title} style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }} />;
}

/** Anything the browser cannot show inline: code, data, slides, archives. */
function FileView({ courseId, resource }: { courseId: string; resource: Resource }) {
  const url = useAssetUrl(courseId, resource.zipPath);
  return (
    <div className="card card--pad row" style={{ justifyContent: "space-between" }}>
      <span>
        <Icon name="file" /> {fileName(resource)}
        {resource.sizeBytes ? <span className="muted"> · {formatBytes(resource.sizeBytes)}</span> : null}
      </span>
      {url && (
        <a className="btn" href={url} download={fileName(resource)}>
          <Icon name="download" /> Download
        </a>
      )}
    </div>
  );
}

function useAssetUrl(courseId: string, zipPath: string | null, mime?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    if (!zipPath) return;
    let live = true;
    void assetUrl(courseId, zipPath, mime ?? guessMime(zipPath))
      .then((next) => live && setUrl(next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [courseId, zipPath, mime]);

  return url;
}

/** The archive's filename, minus the content hash OCW prefixes it with. */
function fileName(resource: Resource): string {
  const base = resource.zipPath?.slice(resource.zipPath.lastIndexOf("/") + 1) ?? resource.title;
  return base.replace(/^[0-9a-f]{32}_/, "");
}

/**
 * The YouTube player. YouTube refuses embeds without a referrer (error 153), so the
 * referrer policy is explicit, and in the desktop app, whose pages have no web origin,
 * the player is hosted by a local page that does (src-tauri/src/video.rs).
 */
function VideoFrame({ id, title }: { id: string; title: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void desktopVideoBase().then((base) => {
      if (!live) return;
      const origin = /^https?:$/.test(location.protocol) ? `&origin=${encodeURIComponent(location.origin)}` : "";
      setSrc(
        base
          ? `${base}/youtube?v=${id}`
          : `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&cc_load_policy=1${origin}`,
      );
    });
    return () => {
      live = false;
    };
  }, [id]);

  if (!src) return null;
  return (
    <iframe
      src={src}
      title={title}
      allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
