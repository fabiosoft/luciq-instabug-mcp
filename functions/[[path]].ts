/**
 * Cloudflare Pages function entrypoint. The [[path]] catch-all matches every
 * route not served by the static `public/` directory.
 */
import { app } from "../src/app.js";

interface PagesContext {
  request: Request;
  env: Record<string, unknown>;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
  next: () => Promise<Response>;
  data: Record<string, unknown>;
}

export const onRequest = (ctx: PagesContext): Response | Promise<Response> =>
  app.fetch(ctx.request, ctx.env);
