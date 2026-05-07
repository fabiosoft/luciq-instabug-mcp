#!/usr/bin/env node
/**
 * MCP stdio transport — for local agents (Claude Desktop / Code).
 *
 * Wires the same shared tool registry used by the streamable-HTTP server
 * onto an stdio JSON-RPC transport via the official @modelcontextprotocol/sdk.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { formatToolContent } from "../mcp-http.js";
import { tools, toolByName } from "../tools.js";

async function main(): Promise<void> {
  const server = new Server(
    { name: "luciq-instabug", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = toolByName(req.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(
        (req.params.arguments as Record<string, unknown>) ?? {},
      );
      return { content: formatToolContent(result), isError: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: msg }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
