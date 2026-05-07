/**
 * Luciq (formerly Instabug) public-share client.
 *
 * Fetches bug metadata, logs and screenshot from a public Luciq dashboard URL,
 * e.g. https://dashboard.luciq.ai/bugs/<token>
 *
 * Pages are public — no auth required. All log files and the screenshot live
 * on signed CloudFront URLs which expire ~3 weeks after the metadata is
 * fetched, so download them promptly.
 *
 * Runtime-agnostic: relies only on the global `fetch` (Node 20+, Vercel,
 * Cloudflare Workers/Pages).
 */

const API_BASE = "https://api.luciq.ai/api/web/public/bugs";
const USER_AGENT = "luciq-instabug-mcp/0.2 (+https://github.com)";

export const LOG_TYPES = [
  "user_steps",
  "console_log",
  "instabug_log",
  "user_data",
  "network_log",
  "user_events",
  "sessions_profiler",
] as const;

export type LogType = (typeof LOG_TYPES)[number];

export class LuciqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LuciqError";
  }
}

export interface BugAsset {
  /** e.g. "instabug_log", "screenshot", "screenshot_thumb" */
  name: string;
  url: string;
  kind: "log" | "image";
  is_empty: boolean;
}

export interface Bug {
  token: string;
  /** full API response (the "bug" object) */
  raw: Record<string, unknown>;
  assets: BugAsset[];
  number: number;
  title: string;
  app_slug: string;
  fields: Record<string, unknown>;
}

const TOKEN_RE = /\/bugs\/([A-Za-z0-9_-]+)/;

export function parseToken(urlOrToken: string): string {
  const s = urlOrToken.trim();
  if (!s.includes("/") && !s.includes("://")) return s;
  let pathname = s;
  try {
    pathname = new URL(s).pathname;
  } catch {
    // not a valid URL, fall back to whole string
  }
  const m = TOKEN_RE.exec(pathname);
  if (!m) throw new LuciqError(`Cannot extract bug token from: ${urlOrToken}`);
  return m[1]!;
}

async function httpGet(url: string, timeoutMs = 30_000): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new LuciqError(`HTTP ${r.status} on ${url}`);
    const buf = await r.arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    if (e instanceof LuciqError) throw e;
    throw new LuciqError(`fetch failed for ${url}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function httpGetJson<T = unknown>(url: string): Promise<T> {
  const bytes = await httpGet(url);
  return JSON.parse(new TextDecoder("utf-8").decode(bytes)) as T;
}

function collectAssets(rawBug: Record<string, unknown>): BugAsset[] {
  const assets: BugAsset[] = [];
  const state = (rawBug.state as Record<string, unknown>) ?? {};
  const logs = (state.logs as Record<string, { is_empty_array?: boolean; url?: string }>) ?? {};

  for (const name of LOG_TYPES) {
    const entry = logs[name] ?? {};
    const isEmpty = Boolean(entry.is_empty_array ?? true);
    const url = entry.url;
    if (url) {
      assets.push({ name, url, kind: "log", is_empty: isEmpty });
    } else if (!isEmpty) {
      // Marked non-empty but missing url — keep a record so callers know.
      assets.push({ name, url: "", kind: "log", is_empty: false });
    }
  }

  const attachments = (state.attachments as Record<string, unknown>) ?? {};
  const shot = (attachments.screenshot as Record<string, string>) ?? {};
  for (const variant of ["original", "big_thumb", "thumb"] as const) {
    const url = shot[variant];
    if (url) {
      const name = variant === "original" ? "screenshot" : `screenshot_${variant}`;
      assets.push({ name, url, kind: "image", is_empty: false });
    }
  }

  return assets;
}

export async function fetchBug(urlOrToken: string): Promise<Bug> {
  const token = parseToken(urlOrToken);
  const raw = await httpGetJson<{ bug?: Record<string, unknown> }>(`${API_BASE}/${token}`);
  if (!raw || !raw.bug) {
    throw new LuciqError(
      `Unexpected response shape: keys=${Object.keys(raw ?? {}).slice(0, 5).join(",")}`,
    );
  }
  const rawBug = raw.bug;
  const stateFields = (rawBug.state as Record<string, unknown> | undefined)?.fields;
  return {
    token,
    raw: rawBug,
    assets: collectAssets(rawBug),
    number: typeof rawBug.number === "number" ? rawBug.number : 0,
    title: typeof rawBug.title === "string" ? rawBug.title : "",
    app_slug: typeof rawBug.app_slug === "string" ? rawBug.app_slug : "",
    fields: (stateFields as Record<string, unknown>) ?? {},
  };
}

export function bugAsset(bug: Bug, name: string): BugAsset | undefined {
  return bug.assets.find((a) => a.name === name);
}

async function fetchLogBody(url: string): Promise<unknown> {
  const bytes = await httpGet(url);
  const text = new TextDecoder("utf-8").decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function fetchLog(bug: Bug, logType: string): Promise<unknown> {
  if (!(LOG_TYPES as readonly string[]).includes(logType)) {
    throw new LuciqError(`Unknown log type ${logType}; available: ${LOG_TYPES.join(",")}`);
  }
  const asset = bugAsset(bug, logType);
  if (!asset) {
    // Log type known but Luciq did not expose it for this bug.
    return [];
  }
  if (asset.is_empty) return [];
  if (!asset.url) throw new LuciqError(`Log ${logType} has no URL`);
  return fetchLogBody(asset.url);
}

export async function fetchScreenshot(bug: Bug, variant = "original"): Promise<Uint8Array> {
  if (!["original", "big_thumb", "thumb"].includes(variant)) {
    throw new LuciqError(`Unknown variant ${variant}; valid: original, big_thumb, thumb`);
  }
  const name = variant === "original" ? "screenshot" : `screenshot_${variant}`;
  const asset = bugAsset(bug, name);
  if (!asset) throw new LuciqError(`Screenshot variant ${variant} not available`);
  return httpGet(asset.url);
}
