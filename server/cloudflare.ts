import { handleApi, optionsFromEnv } from "./core";
import { D1Store, type D1Like } from "./stores/d1";

/**
 * Cloudflare Workers entry: serves the built web app from static assets and the sync
 * API from a D1 database, in one deployment. See wrangler.jsonc and docs/self-hosting.md.
 */

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Optional: without it the site works and sync reports itself unavailable. */
  DB?: D1Like;
  SYNC_MAX_BYTES?: string;
  SYNC_ALLOWED_ORIGINS?: string;
}

let store: D1Store | null = null;

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
      const response = await handleApi(request, store, optionsFromEnv(env as unknown as Record<string, string>));
      if (response) return response;
    }
    return env.ASSETS.fetch(request);
  },
};
