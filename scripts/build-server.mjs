// Bundle the self-hosted Node server (server/node.ts) into one file with no runtime
// dependencies, so it runs with plain `node` and ships in a small Docker image.
import { build } from "esbuild";

await build({
  entryPoints: ["server/node.ts"],
  outfile: "server-dist/node.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
});
