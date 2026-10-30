import { handleApi, optionsFromEnv } from "./core";
import { D1Store, type D1Like } from "./stores/d1";
import { R2BlobStore, type R2Like } from "./stores/blobs-r2";

/**
 * Cloudflare Workers entry: serves the built web app from static assets and the sync
 * API from a D1 database (and course archives from an R2 bucket, if one is bound), in one
 * deployment. See wrangler.jsonc and docs/self-hosting.md.
 */

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Optional: without it the site works and sync reports itself unavailable. */
  DB?: D1Like;
  /** Optional: an R2 bucket for course archives. Without it, only progress syncs. */
  BLOBS?: R2Like;
  SYNC_MAX_BYTES?: string;
  SYNC_ALLOWED_ORIGINS?: string;
  /** "off" turns course storage off even with a bucket bound. */
  COURSE_STORAGE?: string;
}

let store: D1Store | null = null;
let blobs: R2BlobStore | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      if (!env.DB) {
        return Response.json(
          { error: "sync_not_configured", message: "This deployment has no D1 database bound as DB." },
          { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
        );
      }
      store ??= new D1Store(env.DB);
      if (env.BLOBS && env.COURSE_STORAGE !== "off") blobs ??= new R2BlobStore(env.BLOBS);
      const options = { ...optionsFromEnv(env as unknown as Record<string, string>), blobs };
      const response = await handleApi(request, store, options);
      if (response) return response;
    }
    return env.ASSETS.fetch(request);
  },
};
