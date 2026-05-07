/**
 * Hono app: REST API + streamable-HTTP MCP endpoint + landing page.
 *
 * Designed to run unchanged on Node (via @hono/node-server, see bin/serve.ts),
 * Vercel functions (api/index.ts) and Cloudflare Pages functions
 * (functions/[[path]].ts).
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import { INDEX_HTML, FAVICON_SVG } from "./assets.js";
import {
  LOG_TYPES,
  LuciqError,
  bugAsset,
  fetchBug,
  fetchLog,
  fetchScreenshot,
} from "./client.js";
import { handleMcpRequest } from "./mcp-http.js";

type Env = {
  Bindings: {
    CORS_ORIGINS?: string;
  };
};

export const app = new Hono<Env>();

// CORS for browser-based MCP clients (MCP Inspector, custom web agents).
// Exposes the streamable-http session headers so JS clients can read them.
app.use("*", (c, next) => {
  const raw = (c.env?.CORS_ORIGINS ?? globalThis.process?.env?.CORS_ORIGINS ?? "*").trim();
  const origin: string | string[] =
    raw === "*" ? "*" : raw.split(",").map((o) => o.trim()).filter(Boolean);
  return cors({
    origin,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    credentials: false,
  })(c, next);
});

// --- static -----------------------------------------------------------------

app.get("/", (c) => c.html(INDEX_HTML));

app.get("/healthz", (c) => c.text("ok\n"));

app.get("/favicon.svg", (c) => {
  c.header("Content-Type", "image/svg+xml");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(FAVICON_SVG);
});

app.get("/favicon.ico", (c) => c.body(null, 204));

// --- bug REST API -----------------------------------------------------------

app.get("/bugs/:token", async (c) => {
  try {
    const bug = await fetchBug(c.req.param("token"));
    return c.json({
      number: bug.number,
      title: bug.title,
      app_slug: bug.app_slug,
      fields: bug.fields,
      assets: bug.assets.map((a) => ({
        name: a.name,
        kind: a.kind,
        is_empty: a.is_empty,
        has_url: Boolean(a.url),
      })),
      raw: bug.raw,
    });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get("/bugs/:token/logs", async (c) => {
  try {
    const bug = await fetchBug(c.req.param("token"));
    const out: Record<string, unknown> = {};
    for (const name of LOG_TYPES) {
      const asset = bugAsset(bug, name);
      if (!asset || asset.is_empty || !asset.url) {
        out[name] = null;
        continue;
      }
      out[name] = await fetchLog(bug, name);
    }
    return c.json(out);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get("/bugs/:token/logs/:type", async (c) => {
  const type = c.req.param("type");
  if (!(LOG_TYPES as readonly string[]).includes(type)) {
    return c.json(
      { error: `unknown log type: ${type}`, valid: [...LOG_TYPES] },
      400,
    );
  }
  try {
    const bug = await fetchBug(c.req.param("token"));
    return c.json(await fetchLog(bug, type));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get("/bugs/:token/screenshot", async (c) => {
  const variant = c.req.query("variant") ?? "original";
  try {
    const bug = await fetchBug(c.req.param("token"));
    const data = await fetchScreenshot(bug, variant);
    return new Response(data as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(data.length),
      },
    });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// --- MCP streamable-HTTP ----------------------------------------------------

app.all("/mcp", (c) => handleMcpRequest(c.req.raw));

// --- 404 fallback -----------------------------------------------------------

app.notFound((c) => c.json({ error: "not found" }, 404));

// --- helpers ----------------------------------------------------------------

import type { Context } from "hono";

function errorResponse(c: Context, e: unknown): Response {
  if (e instanceof LuciqError) {
    return c.json({ error: e.message }, 502);
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error("unhandled error:", e);
  return c.json({ error: msg }, 500);
}

export default app;
