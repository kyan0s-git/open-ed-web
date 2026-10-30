import { handleApi, optionsFromEnv } from "../server/core";
import { RedisRestStore, redisConfigFromEnv } from "../server/stores/redis";

/**
 * Vercel Function for the sync API. vercel.json rewrites /api/v1/* here, passing the
 * original path as ?route=, and the static web app is served from dist/.
 *
 * Storage is Upstash Redis: add it from the Vercel Marketplace (Storage → Upstash →
 * Redis) and connect it to the project; its environment variables are read here.
 */

const config = redisConfigFromEnv(process.env);
const store = config ? new RedisRestStore(config) : null;
const options = optionsFromEnv(process.env);

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
