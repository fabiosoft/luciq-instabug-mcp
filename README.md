# luciq-instabug-mcp

Fetch logs and screenshot from a public **Luciq** (formerly Instabug) bug report
URL like `https://dashboard.luciq.ai/bugs/<token>`.

The public API requires no auth. Logs and the screenshot live on signed
CloudFront URLs that expire ~3 weeks after metadata is fetched, so download
them promptly.

## Layout

- [luciq_client.py](luciq_client.py) — pure-Python client (stdlib only).
  Reusable from the upcoming MCP server.
- [luciq_fetch.py](luciq_fetch.py) — CLI wrapper.
- [luciq_server.py](luciq_server.py) — minimal REST HTTP wrapper (stdlib).
- [luciq_mcp_server.py](luciq_mcp_server.py) — **MCP server** for AI agents
  (stdio + streamable-HTTP).
- [requirements.txt](requirements.txt) — only `mcp` (the official SDK).
- [Dockerfile](Dockerfile) — runtime image (`python:3.13-slim`).
- [docker-compose.yml](docker-compose.yml) — service joined to the external
  `reverse-proxy` network. Default command runs the MCP server.

## Usage (local)

```bash
python3 luciq_fetch.py https://dashboard.luciq.ai/bugs/<token>
# → ./bug-<number>/{bug.json, logs/*.json, screenshot.jpg}
```

Options: `-o OUT`, `--no-screenshot`, `--logs instabug_log,network_log`,
`--quiet`.

## Usage (Docker, one-shot CLI)

```bash
docker build -t luciq-instabug-mcp .
docker run --rm -v "$PWD/out:/data" \
  --entrypoint python luciq-instabug-mcp \
  /app/luciq_fetch.py <url-or-token>
# → ./out/bug-<number>/
```

## Usage (Docker Compose, HTTP service on `reverse-proxy` network)

Make sure the external network exists once:

```bash
docker network create reverse-proxy   # only if missing
docker compose up -d --build
```

Routes (all `GET`):

| Path | Description |
|---|---|
| `/healthz` | liveness probe |
| `/bugs/<token>` | bug metadata + asset list + raw API payload |
| `/bugs/<token>/logs` | every non-empty log merged into one JSON object |
| `/bugs/<token>/logs/<type>` | single log (`user_steps`, `instabug_log`, `network_log`, `sessions_profiler`, …) |
| `/bugs/<token>/screenshot[?variant=original\|big_thumb\|thumb]` | JPEG bytes |

`<token>` may be the bare token or a URL-encoded full dashboard URL.

## Endpoint reference

`GET https://api.luciq.ai/api/web/public/bugs/<token>` returns a JSON whose
`bug.state.logs.*.url` and `bug.state.attachments.screenshot.original` are
the signed CloudFront URLs we download.

Available log types: `user_steps`, `console_log`, `instabug_log`, `user_data`,
`network_log`, `user_events`, `sessions_profiler`. Logs are JSON arrays of
entries (the client returns parsed JSON when possible, raw text otherwise).

## MCP server (for AI agents)

[luciq_mcp_server.py](luciq_mcp_server.py) implements an MCP server using the
official Anthropic [`mcp`](https://pypi.org/project/mcp/) SDK. It supports
two transports, controlled by `MCP_TRANSPORT`:

| Transport | When to use |
|---|---|
| `stdio` *(default)* | Local agents (Claude Desktop, Claude Code, Cursor) — the agent spawns the server as a subprocess. |
| `streamable-http` | Remote agents reaching the server over HTTP, e.g. through the reverse proxy. Listens on `${MCP_HOST}:${MCP_PORT}${MCP_PATH}` (defaults `0.0.0.0:8080/mcp`). |

### Tools exposed

| Tool | Purpose |
|---|---|
| `list_log_types()` | enumerate the log-type names |
| `get_bug(token)` | metadata + asset list (no log bodies) |
| `get_device_info(token)` | OS, device, app version, locale, … |
| `get_log(token, log_type)` | a single log type (recommended) |
| `get_all_logs(token)` | every non-empty log merged (heavy) |
| `get_screenshot(token, variant?)` | JPEG returned as MCP `ImageContent` so vision-capable agents can see it. `variant` ∈ `original`, `big_thumb`, `thumb`. |

`token` is either the bare share token or the full
`https://dashboard.luciq.ai/bugs/<token>` URL.

### Use it from Claude Desktop / Claude Code (stdio)

```bash
pip install -r requirements.txt
```

`~/.claude/claude_desktop_config.json` (or the project-local equivalent):

```jsonc
{
  "mcpServers": {
    "luciq": {
      "command": "python",
      "args": ["/absolute/path/to/luciq_mcp_server.py"],
      "env": { "MCP_TRANSPORT": "stdio" }
    }
  }
}
```

Or via Docker (stdio over `docker run -i`):

```jsonc
{
  "mcpServers": {
    "luciq": {
      "command": "docker",
      "args": ["run","--rm","-i","-e","MCP_TRANSPORT=stdio",
               "luciq-instabug-mcp:latest"]
    }
  }
}
```

### Use it from a remote agent (streamable-HTTP)

`docker compose up -d --build` already runs in this mode on
`http://localhost:8080/mcp` (and inside the network on
`http://luciq-mcp:8080/mcp`). Configure the agent to talk to that URL.

Quick connectivity check:

```bash
# A bare GET is rejected (406) by design — the MCP transport requires
# content negotiation, so 406 here actually proves the endpoint is up.
curl -i http://localhost:8080/mcp
```

For a full handshake test:

```python
# pip install mcp
import asyncio
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def main():
    async with streamablehttp_client("http://localhost:8080/mcp") as (r, w, _):
        async with ClientSession(r, w) as s:
            await s.initialize()
            print([t.name for t in (await s.list_tools()).tools])

asyncio.run(main())
```
