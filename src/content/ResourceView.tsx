import { useEffect, useState } from "react";
import type { Resource } from "./schema";
import { assetUrl } from "./assets";

/**
 * Displays one resource.
 *
 * PDFs go to the browser's own viewer through a blob URL — it handles paging, search
 * and printing already, and pulling in a JavaScript PDF renderer would cost more than
 * the whole reader. Videos are not shipped inside OCW archives, so they play from
 * YouTube using the id the archive carries.
 */
export function ResourceView({ courseId, resource }: { courseId: string; resource: Resource }) {
  if (resource.youtubeId) return <Video youtubeId={resource.youtubeId} title={resource.title} />;
  if (resource.zipPath && resource.mime === "application/pdf") {
    return <PdfView courseId={courseId} resource={resource} />;
  }
  if (resource.zipPath && resource.resourcetype === "Image") {
    return <ImageView courseId={courseId} resource={resource} />;
  }
  return null;
}

function Video({ youtubeId, title }: { youtubeId: string; title: string }) {
  const [playing, setPlaying] = useState(false);

  // A facade until clicked: embedding the player up front pulls in a lot of script for
  // a video that may never be watched.
  if (!playing) {
    return (
      <button className="video" type="button" onClick={() => setPlaying(true)}>
        <img
          src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`}
          alt=""
          width={480}
          height={360}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <span className="sr-only">Play {title}</span>
      </button>
    );
  }

  return (
    <div className="video">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1`}
        title={title}
        allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

function PdfView({ courseId, resource }: { courseId: string; resource: Resource }) {
  const url = useAssetUrl(courseId, resource);
  if (!url) return <p className="empty">Loading…</p>;

  return <iframe className="viewer" src={url} title={resource.title} />;
}

function ImageView({ courseId, resource }: { courseId: string; resource: Resource }) {
  const url = useAssetUrl(courseId, resource);
  if (!url) return null;

  return <img src={url} alt={resource.title} style={{ maxWidth: "100%", height: "auto" }} />;
}

function useAssetUrl(courseId: string, resource: Resource): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!resource.zipPath) return;
    let live = true;
    void assetUrl(courseId, resource.zipPath, resource.mime).then((next) => {
      if (live) setUrl(next);
    });
    return () => {
      live = false;
    };
  }, [courseId, resource.zipPath, resource.mime]);

  return url;
}
