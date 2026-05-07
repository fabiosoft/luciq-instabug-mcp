/**
 * MCP tool registry.
 *
 * Tools are defined once here and consumed by both the stdio transport
 * (`bin/mcp-stdio.ts`) and the streamable-HTTP transport (`mcp-http.ts`).
 */

import {
  LOG_TYPES,
  LuciqError,
  bugAsset,
  fetchBug,
  fetchLog,
  fetchScreenshot,
} from "./client.js";

export type ToolResult =
  | { type: "json"; data: unknown }
  | { type: "image"; data: Uint8Array; mimeType: string };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const tokenArg = {
  type: "string",
  description: "Public dashboard URL or bare bug token (https://dashboard.luciq.ai/bugs/<token>).",
} as const;

export const tools: ToolDef[] = [
  {
    name: "list_log_types",
    description:
      "Return the log types Luciq exposes for a bug report. Use these as the `log_type` argument of `get_log`.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async () => ({ type: "json", data: [...LOG_TYPES] }),
  },
  {
    name: "get_bug",
    description:
      "Fetch bug metadata and the list of available assets (logs + screenshot variants) for a public Luciq share. Returns title, number, app slug, device fields, plus an `assets` list whose `name` values can be passed to `get_log` or `get_screenshot`. Does NOT download log bodies.",
    inputSchema: {
      type: "object",
      properties: { token: tokenArg },
      required: ["token"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const token = requireString(args, "token");
      const bug = await fetchBug(token);
      return {
        type: "json",
        data: {
          number: bug.number,
          title: bug.title,
          app_slug: bug.app_slug,
          fields: bug.fields,
          assets: bug.assets.map((a) => ({
            name: a.name,
            kind: a.kind,
            is_empty: a.is_empty,
            available: Boolean(a.url) && !a.is_empty,
          })),
        },
      };
    },
  },
  {
    name: "get_device_info",
    description:
      "Return only the device/OS/app metadata for a bug (os, device, app_version, sdk_version, locale, screen_size, bundle_id, duration, …). Cheap — useful to triage before pulling logs.",
    inputSchema: {
      type: "object",
      properties: { token: tokenArg },
      required: ["token"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const token = requireString(args, "token");
      const bug = await fetchBug(token);
      return {
        type: "json",
        data: {
          number: bug.number,
          title: bug.title,
          app_slug: bug.app_slug,
          ...bug.fields,
        },
      };
    },
  },
  {
    name: "get_log",
    description:
      "Fetch a single log type for a bug. `log_type` must be one of the names returned by `list_log_types`. Returns a JSON list of entries (or [] if Luciq marks it empty). Raw text fallback if the body isn't JSON.",
    inputSchema: {
      type: "object",
      properties: {
        token: tokenArg,
        log_type: {
          type: "string",
          enum: [...LOG_TYPES],
        },
      },
      required: ["token", "log_type"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const token = requireString(args, "token");
      const logType = requireString(args, "log_type");
      if (!(LOG_TYPES as readonly string[]).includes(logType)) {
        throw new LuciqError(
          `unknown log_type ${logType}; valid: ${LOG_TYPES.join(",")}`,
        );
      }
      const bug = await fetchBug(token);
      return { type: "json", data: await fetchLog(bug, logType) };
    },
  },
  {
    name: "get_all_logs",
    description:
      "Fetch every non-empty log for a bug, keyed by log type. Use sparingly — a single bug can return >200 KB of network logs. Prefer `get_log` when you only need one type.",
    inputSchema: {
      type: "object",
      properties: { token: tokenArg },
      required: ["token"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const token = requireString(args, "token");
      const bug = await fetchBug(token);
      const out: Record<string, unknown> = {};
      for (const name of LOG_TYPES) {
        const asset = bugAsset(bug, name);
        if (!asset || asset.is_empty || !asset.url) {
          out[name] = null;
          continue;
        }
        try {
          out[name] = await fetchLog(bug, name);
        } catch (e) {
          out[name] = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      return { type: "json", data: out };
    },
  },
  {
    name: "get_screenshot",
    description:
      "Download the bug's screenshot as an image the agent can view. `variant`: `original` (full quality), `big_thumb`, or `thumb`.",
    inputSchema: {
      type: "object",
      properties: {
        token: tokenArg,
        variant: {
          type: "string",
          enum: ["original", "big_thumb", "thumb"],
          default: "original",
        },
      },
      required: ["token"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const token = requireString(args, "token");
      const variant =
        typeof args.variant === "string" && args.variant.length > 0
          ? args.variant
          : "original";
      const bug = await fetchBug(token);
      const data = await fetchScreenshot(bug, variant);
      return { type: "image", data, mimeType: "image/jpeg" };
    },
  },
];

export const toolByName = (name: string): ToolDef | undefined =>
  tools.find((t) => t.name === name);

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new LuciqError(`missing or empty argument '${key}'`);
  }
  return v;
}
