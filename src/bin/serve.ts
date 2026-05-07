#!/usr/bin/env node
/**
 * Node HTTP entrypoint — the Docker default and `npm start` target.
 *
 * Boots the Hono app on @hono/node-server. Serves the REST API at the root
 * and the streamable-HTTP MCP endpoint at /mcp.
 *
 * Env:
 *   PORT          (default 8080)
 *   HOST          (default 0.0.0.0)
 *   LOG_LEVEL     (default info)
 *   CORS_ORIGINS  (default *) — comma-separated origin list
 */

import { serve } from "@hono/node-server";
import { app } from "../app.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

const server = serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
});

const ts = () => new Date().toISOString();
console.log(`${ts()} INFO Listening on http://${HOST}:${PORT}`);

const shutdown = (signal: string) => {
  console.log(`${ts()} INFO ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
