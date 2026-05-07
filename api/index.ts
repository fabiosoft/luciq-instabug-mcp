/**
 * Vercel function entrypoint. The vercel.json rewrite sends every request to
 * /api, and Hono dispatches internally to the right route.
 *
 * Vercel's Node runtime sometimes hands the function a Node IncomingMessage
 * instead of a Web Request — Hono's middleware expects `req.headers.get(...)`,
 * which doesn't exist on plain header objects and causes a 504 loop. This
 * wrapper normalizes both shapes into a Web Request before delegating.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { app } from "../src/app.js";

export const config = {
  runtime: "nodejs",
};

type WebOrNodeReq = Request | (IncomingMessage & { body?: unknown });

const isWebRequest = (req: WebOrNodeReq): req is Request =>
  typeof (req as Request).headers?.get === "function" &&
  typeof (req as Request).url === "string" &&
  ((req as Request).url ?? "").startsWith("http");

const toWebRequest = (req: IncomingMessage): Request => {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const host = (req.headers["x-forwarded-host"] as string) ?? req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `${proto}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (typeof value === "string") headers.set(key, value);
  }

  const method = (req.method ?? "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(url, {
    method,
    headers,
    body: hasBody ? (req as unknown as ReadableStream) : undefined,
    // @ts-expect-error - duplex required by undici when body is a stream
    duplex: hasBody ? "half" : undefined,
  });
};

export default async function handler(
  req: WebOrNodeReq,
  res?: ServerResponse,
): Promise<Response | void> {
  const webReq = isWebRequest(req) ? req : toWebRequest(req as IncomingMessage);
  const response = await app.fetch(webReq);

  if (!res) return response;

  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } else {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length) res.write(buf);
  }
  res.end();
}
