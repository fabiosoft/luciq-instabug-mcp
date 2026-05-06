#!/usr/bin/env python3
"""MCP server exposing Luciq (formerly Instabug) public-share data to AI agents.

Tools:
    list_log_types()                      → list of available log types
    get_bug(token)                        → metadata + asset list
    get_log(token, log_type)              → entries of a single log type
    get_all_logs(token)                   → all non-empty logs merged
    get_device_info(token)                → device/OS/app fields only
    get_screenshot(token, variant?)       → image (ImageContent)

Transport (env `MCP_TRANSPORT`):
    stdio (default)              local agents (Claude Desktop / Code)
    streamable-http              remote agents via HTTP, listens on
                                 ${MCP_HOST:-0.0.0.0}:${MCP_PORT:-8080}
                                 at the path ${MCP_PATH:-/mcp}

`<token>` accepts either the bare token or the full dashboard URL
`https://dashboard.luciq.ai/bugs/<token>`.
"""
from __future__ import annotations

import os
from typing import Any

from mcp.server.fastmcp import FastMCP, Image

from luciq_client import (
    LOG_TYPES,
    LuciqError,
    fetch_bug,
    fetch_log,
    fetch_screenshot,
)

INSTRUCTIONS = (
    "Tools to fetch a public Luciq (formerly Instabug) bug report — metadata, "
    "logs, device info, and screenshot. Pass the share URL or just the token "
    "from https://dashboard.luciq.ai/bugs/<token>. Logs are JSON arrays of "
    "structured entries; large logs (especially network_log) can be hundreds "
    "of KB, so prefer get_log over get_all_logs when you only need one type."
)

mcp = FastMCP(
    "luciq-instabug",
    instructions=INSTRUCTIONS,
    host=os.environ.get("MCP_HOST", "0.0.0.0"),
    port=int(os.environ.get("MCP_PORT", "8080")),
    streamable_http_path=os.environ.get("MCP_PATH", "/mcp"),
)


@mcp.tool()
def list_log_types() -> list[str]:
    """Return the log types Luciq exposes for a bug report. Use these as the
    `log_type` argument of `get_log`."""
    return list(LOG_TYPES)


@mcp.tool()
def get_bug(token: str) -> dict[str, Any]:
    """Fetch bug metadata and the list of available assets (logs + screenshot
    variants) for a public Luciq share. Returns title, number, app slug,
    device fields, plus an `assets` list whose `name` values can be passed to
    `get_log` or `get_screenshot`. Does NOT download log bodies."""
    try:
        bug = fetch_bug(token)
    except LuciqError as e:
        raise ValueError(str(e)) from e
    return {
        "number": bug.number,
        "title": bug.title,
        "app_slug": bug.app_slug,
        "fields": bug.fields,
        "assets": [
            {
                "name": a.name,
                "kind": a.kind,
                "is_empty": a.is_empty,
                "available": bool(a.url) and not a.is_empty,
            }
            for a in bug.assets
        ],
    }


@mcp.tool()
def get_device_info(token: str) -> dict[str, Any]:
    """Return only the device/OS/app metadata for a bug
    (os, device, app_version, sdk_version, locale, screen_size, bundle_id,
    duration, …). Cheap — useful to triage before pulling logs."""
    try:
        bug = fetch_bug(token)
    except LuciqError as e:
        raise ValueError(str(e)) from e
    return {
        "number": bug.number,
        "title": bug.title,
        "app_slug": bug.app_slug,
        **bug.fields,
    }


@mcp.tool()
def get_log(token: str, log_type: str) -> Any:
    """Fetch a single log type for a bug. `log_type` must be one of the names
    returned by `list_log_types`. Returns a JSON list of entries (or [] if
    Luciq marks it empty). Raw text fallback if the body isn't JSON."""
    if log_type not in LOG_TYPES:
        raise ValueError(
            f"unknown log_type {log_type!r}; valid: {list(LOG_TYPES)}"
        )
    try:
        bug = fetch_bug(token)
        return fetch_log(bug, log_type)
    except LuciqError as e:
        raise ValueError(str(e)) from e


@mcp.tool()
def get_all_logs(token: str) -> dict[str, Any]:
    """Fetch every non-empty log for a bug, keyed by log type. Use sparingly —
    a single bug can return >200 KB of network logs. Prefer `get_log` when
    you only need one type."""
    try:
        bug = fetch_bug(token)
    except LuciqError as e:
        raise ValueError(str(e)) from e
    out: dict[str, Any] = {}
    for name in LOG_TYPES:
        asset = bug.asset(name)
        if asset is None or asset.is_empty or not asset.url:
            out[name] = None
            continue
        try:
            out[name] = fetch_log(bug, name)
        except LuciqError as e:
            out[name] = {"error": str(e)}
    return out


@mcp.tool()
def get_screenshot(token: str, variant: str = "original") -> Image:
    """Download the bug's screenshot as an image the agent can view.
    `variant`: `original` (full quality), `big_thumb`, or `thumb`."""
    if variant not in ("original", "big_thumb", "thumb"):
        raise ValueError(
            f"unknown variant {variant!r}; valid: original, big_thumb, thumb"
        )
    try:
        bug = fetch_bug(token)
        data = fetch_screenshot(bug, variant)
    except LuciqError as e:
        raise ValueError(str(e)) from e
    return Image(data=data, format="jpeg")


def _serve_http(transport: str) -> None:
    """Run the HTTP transport with CORS so that browser-based MCP clients
    (e.g. MCP Inspector hosted on a different origin) can connect."""
    import uvicorn
    from starlette.middleware.cors import CORSMiddleware
    from starlette.responses import HTMLResponse, PlainTextResponse, Response
    from starlette.routing import Route

    from luciq_server import FAVICON_PATH, _index_html

    if transport == "sse":
        app = mcp.sse_app()
    else:
        app = mcp.streamable_http_app()

    async def _index(_request):
        return HTMLResponse(_index_html())

    async def _healthz(_request):
        return PlainTextResponse("ok\n")

    async def _favicon_svg(_request):
        return Response(
            FAVICON_PATH.read_bytes(),
            media_type="image/svg+xml",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    async def _favicon_ico(_request):
        return Response(status_code=204)

    # Prepend our routes so they win over the MCP catch-all.
    app.routes.insert(0, Route("/", _index, methods=["GET"]))
    app.routes.insert(1, Route("/healthz", _healthz, methods=["GET"]))
    app.routes.insert(2, Route("/favicon.svg", _favicon_svg, methods=["GET"]))
    app.routes.insert(3, Route("/favicon.ico", _favicon_ico, methods=["GET"]))

    raw = os.environ.get("CORS_ORIGINS", "*").strip()
    origins = ["*"] if raw == "*" else [o.strip() for o in raw.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        # MCP streamable-http negotiates a session via this header — the
        # client can't read it back without an explicit expose_headers.
        expose_headers=["mcp-session-id", "mcp-protocol-version"],
    )

    uvicorn.run(
        app,
        host=mcp.settings.host,
        port=mcp.settings.port,
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio").lower()
    if transport == "stdio":
        mcp.run(transport="stdio")
    elif transport in ("http", "streamable-http", "streamable_http"):
        _serve_http("streamable-http")
    elif transport == "sse":
        _serve_http("sse")
    else:
        raise SystemExit(
            f"unknown MCP_TRANSPORT={transport!r} (use stdio, streamable-http, sse)"
        )


if __name__ == "__main__":
    main()
