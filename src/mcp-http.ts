/**
 * Stateless MCP-over-HTTP (streamable-http) handler.
 *
 * Implements the JSON-RPC subset needed by the Model Context Protocol for a
 * stateless tools-only server: `initialize`, `tools/list`, `tools/call`, plus
 * `ping` and the `notifications/initialized` no-op. Stateless mode means no
 * session ids, no SSE streams — every call is a single POST/JSON exchange.
 *
 * This intentionally does NOT use the @modelcontextprotocol/sdk because that
 * package's HTTP transport relies on Node-only APIs. The hand-rolled handler
 * runs unchanged on Node, Vercel functions and Cloudflare Workers/Pages.
 */

import { tools, toolByName, type ToolResult } from "./tools.js";

const SERVER_INFO = {
  name: "luciq-instabug",
  version: "0.2.0",
} as const;

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export async function handleMcpRequest(request: Request): Promise<Response> {
  // The streamable-http GET endpoint is reserved for SSE in stateful mode.
  // Stateless server rejects with 405 — same effect as the Python build's
  // 406 from FastMCP, just with a more accurate status.
  if (request.method === "GET") {
    return text(405, "Method Not Allowed (stateless MCP)");
  }
  if (request.method === "DELETE") {
    // No session to terminate — accept and move on.
    return new Response(null, { status: 204 });
  }
  if (request.method !== "POST") {
    return text(405, "Method Not Allowed");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(parseError(null), 200);
  }

  const requests = Array.isArray(body) ? body : [body];
  const responses: JsonRpcResponse[] = [];
  for (const r of requests) {
    const resp = await handleOne(r as JsonRpcRequest);
    if (resp) responses.push(resp);
  }

  if (responses.length === 0) {
    // Pure notification batch — spec says return 202 Accepted with no body.
    return new Response(null, { status: 202 });
  }
  const payload = Array.isArray(body) ? responses : responses[0];
  return json(payload!, 200);
}

async function handleOne(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return invalidRequest(req?.id ?? null);
  }
  const id = req.id ?? null;
  // Notifications (no id) → no response per JSON-RPC.
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case "initialize":
        if (isNotification) return null;
        return success(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });

      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/progress":
      case "notifications/roots/list_changed":
        return null;

      case "ping":
        if (isNotification) return null;
        return success(id, {});

      case "tools/list":
        if (isNotification) return null;
        return success(id, {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case "tools/call": {
        if (isNotification) return null;
        const params = req.params ?? {};
        const name = typeof params.name === "string" ? params.name : "";
        const tool = toolByName(name);
        if (!tool) {
          return success(id, {
            content: [{ type: "text", text: `unknown tool: ${name}` }],
            isError: true,
          });
        }
        const args = (params.arguments as Record<string, unknown>) ?? {};
        try {
          const result = await tool.handler(args);
          return success(id, {
            content: formatToolContent(result),
            isError: false,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return success(id, {
            content: [{ type: "text", text: msg }],
            isError: true,
          });
        }
      }

      default:
        if (isNotification) return null;
        return methodNotFound(id, req.method);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return internalError(id, msg);
  }
}

export function formatToolContent(result: ToolResult): unknown[] {
  if (result.type === "json") {
    return [{ type: "text", text: JSON.stringify(result.data, null, 2) }];
  }
  return [
    {
      type: "image",
      data: bytesToBase64(result.data),
      mimeType: result.mimeType,
    },
  ];
}

// --- helpers ---------------------------------------------------------------

function success(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function errorResp(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const parseError = (id: string | number | null) => errorResp(id, -32700, "Parse error");
const invalidRequest = (id: string | number | null) =>
  errorResp(id, -32600, "Invalid Request");
const methodNotFound = (id: string | number | null, method: string) =>
  errorResp(id, -32601, `Method not found: ${method}`);
const internalError = (id: string | number | null, msg: string) =>
  errorResp(id, -32603, msg);

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function text(status: number, body: string): Response {
  return new Response(body + "\n", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Node has Buffer; Workers/Vercel-Edge expose btoa.
  if (typeof globalThis.Buffer !== "undefined") {
    return globalThis.Buffer.from(bytes).toString("base64");
  }
  // Manual fallback. Build a binary string in 8 KB chunks to avoid
  // String.fromCharCode argument-list blowups on large screenshots.
  let binary = "";
  const CHUNK = 0x2000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  // eslint-disable-next-line no-restricted-globals
  return btoa(binary);
}
