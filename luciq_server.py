#!/usr/bin/env python3
"""Minimal HTTP wrapper around luciq_client.

Routes (all GET):
    /healthz                         → 200 "ok"
    /bugs/<token>                    → bug metadata JSON (+ asset list)
    /bugs/<token>/logs               → all non-empty logs merged in one JSON
    /bugs/<token>/logs/<type>        → a single log type (JSON)
    /bugs/<token>/screenshot[?variant=original|big_thumb|thumb]
                                     → JPEG bytes
    /                                → short usage info

`<token>` may be a bare token or a URL-encoded full dashboard URL.

stdlib only. Bound to 0.0.0.0:${PORT:-8080}.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from luciq_client import (
    LOG_TYPES,
    LuciqError,
    fetch_bug,
    fetch_log,
    fetch_screenshot,
)

PORT = int(os.environ.get("PORT", "8080"))
HOST = os.environ.get("HOST", "0.0.0.0")

USAGE = (
    "luciq-instabug-mcp HTTP API\n"
    "  GET /healthz\n"
    "  GET /bugs/<token>\n"
    "  GET /bugs/<token>/logs\n"
    "  GET /bugs/<token>/logs/<type>   types: " + ",".join(LOG_TYPES) + "\n"
    "  GET /bugs/<token>/screenshot?variant=original|big_thumb|thumb\n"
)

INDEX_HTML_PATH = Path(__file__).parent / "index.html"
FAVICON_PATH = Path(__file__).parent / "favicon.svg"


def _index_html() -> str:
    return INDEX_HTML_PATH.read_text(encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "luciq-mcp/0.1"

    # silence default access log; we use our own logger
    def log_message(self, fmt, *args):
        logging.info("%s - %s", self.address_string(), fmt % args)

    def do_GET(self):  # noqa: N802
        try:
            self._dispatch()
        except LuciqError as e:
            self._json(HTTPStatus.BAD_GATEWAY, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            logging.exception("unhandled error")
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(e)})

    # --- routing ---

    def _dispatch(self):
        u = urllib.parse.urlsplit(self.path)
        parts = [p for p in u.path.split("/") if p]
        qs = urllib.parse.parse_qs(u.query)

        if not parts:
            return self._html(HTTPStatus.OK, _index_html())
        if parts == ["healthz"]:
            return self._text(HTTPStatus.OK, "ok\n")
        if parts == ["favicon.svg"]:
            return self._binary(
                HTTPStatus.OK, FAVICON_PATH.read_bytes(), "image/svg+xml"
            )
        if parts == ["favicon.ico"]:
            return self._binary(HTTPStatus.NO_CONTENT, b"", "image/x-icon")
        if parts[0] != "bugs" or len(parts) < 2:
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

        token = urllib.parse.unquote(parts[1])
        rest = parts[2:]

        if not rest:
            bug = fetch_bug(token)
            return self._json(HTTPStatus.OK, {
                "number": bug.number,
                "title": bug.title,
                "app_slug": bug.app_slug,
                "fields": bug.fields,
                "assets": [
                    {"name": a.name, "kind": a.kind, "is_empty": a.is_empty,
                     "has_url": bool(a.url)}
                    for a in bug.assets
                ],
                "raw": bug.raw,
            })

        if rest[0] == "logs":
            bug = fetch_bug(token)
            if len(rest) == 1:
                out = {}
                for name in LOG_TYPES:
                    asset = bug.asset(name)
                    if asset is None or asset.is_empty or not asset.url:
                        out[name] = None
                        continue
                    out[name] = fetch_log(bug, name)
                return self._json(HTTPStatus.OK, out)
            if len(rest) == 2:
                log_type = rest[1]
                if log_type not in LOG_TYPES:
                    return self._json(HTTPStatus.BAD_REQUEST,
                                      {"error": f"unknown log type: {log_type}",
                                       "valid": list(LOG_TYPES)})
                return self._json(HTTPStatus.OK, fetch_log(bug, log_type))

        if rest == ["screenshot"]:
            variant = (qs.get("variant", ["original"])[0] or "original")
            bug = fetch_bug(token)
            data = fetch_screenshot(bug, variant)
            return self._binary(HTTPStatus.OK, data, "image/jpeg")

        return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    # --- responders ---

    def _json(self, status: HTTPStatus, payload):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, status: HTTPStatus, html: str):
        body = html.encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _text(self, status: HTTPStatus, text: str):
        body = text.encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _binary(self, status: HTTPStatus, data: bytes, ctype: str):
        self.send_response(int(status))
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    logging.info("Listening on http://%s:%d", HOST, PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
