import { handleApi, optionsFromEnv } from "../server/core";
import { RedisRestStore, redisConfigFromEnv } from "../server/stores/redis";
import { VercelBlobStore } from "../server/stores/blobs-vercel";

/**
 * Vercel Function for the sync API. vercel.json rewrites /api/v1/* here, passing the
 * original path as ?route=, and the static web app is served from dist/.
 *
 * Storage is Upstash Redis: add it from the Vercel Marketplace (Storage → Upstash →
 * Redis) and connect it to the project; its environment variables are read here.
 * Course archives go in Vercel Blob, if a Blob store is connected (BLOB_READ_WRITE_TOKEN).
 */

const config = redisConfigFromEnv(process.env);
const store = config ? new RedisRestStore(config) : null;
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const options = {
  ...optionsFromEnv(process.env),
  blobs: blobToken && process.env.COURSE_STORAGE !== "off" ? new VercelBlobStore(blobToken) : null,
  // Vercel caps request and response bodies at 4.5 MB, so chunks cannot be raised here.
  chunkBytes: Math.min(optionsFromEnv(process.env).chunkBytes ?? 4 * 1024 * 1024, 4 * 1024 * 1024),
};

async function handle(request: Request): Promise<Response> {
  if (!store) {
    return Response.json(
      { error: "sync_not_configured", message: "Connect an Upstash Redis database to this project to enable sync." },
      { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  return (await handleApi(request, store, options)) ?? Response.json({ error: "not_found" }, { status: 404 });
}

export { handle as GET, handle as PUT, handle as DELETE, handle as OPTIONS };
