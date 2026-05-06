"""Luciq (formerly Instabug) public-share client.

Fetches bug metadata, logs and screenshot from a public Luciq dashboard URL,
e.g. https://dashboard.luciq.ai/bugs/<token>

The pages are public — no authentication required. All log files and the
screenshot live on signed CloudFront URLs which expire ~3 weeks after the
metadata is fetched, so download them promptly.
"""
from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

API_BASE = "https://api.luciq.ai/api/web/public/bugs"
USER_AGENT = "luciq-instabug-mcp/0.1 (+https://github.com)"

# state.logs[<key>] entries that carry a `url` to a log .txt file
LOG_TYPES = (
    "user_steps",
    "console_log",
    "instabug_log",
    "user_data",
    "network_log",
    "user_events",
    "sessions_profiler",
)


class LuciqError(RuntimeError):
    pass


@dataclass
class BugAsset:
    """A downloadable artefact attached to a bug (log file or image)."""

    name: str           # e.g. "instabug_log", "screenshot", "screenshot_thumb"
    url: str
    kind: str           # "log" | "image"
    is_empty: bool = False
    parsed: Any = None  # for logs: parsed JSON if the body is valid JSON


@dataclass
class Bug:
    token: str
    raw: dict           # full API response (the "bug" object)
    assets: list[BugAsset] = field(default_factory=list)

    @property
    def number(self) -> int:
        return self.raw.get("number", 0)

    @property
    def title(self) -> str:
        return self.raw.get("title", "") or ""

    @property
    def app_slug(self) -> str:
        return self.raw.get("app_slug", "") or ""

    @property
    def fields(self) -> dict:
        return self.raw.get("state", {}).get("fields", {}) or {}

    def asset(self, name: str) -> BugAsset | None:
        for a in self.assets:
            if a.name == name:
                return a
        return None


# --- token parsing ---------------------------------------------------------

_TOKEN_RE = re.compile(r"/bugs/([A-Za-z0-9_\-]+)")


def parse_token(url_or_token: str) -> str:
    """Accept either a full dashboard URL or a bare token, return the token."""
    s = url_or_token.strip()
    if "/" not in s and "://" not in s:
        return s
    m = _TOKEN_RE.search(urlparse(s).path)
    if not m:
        raise LuciqError(f"Cannot extract bug token from: {url_or_token!r}")
    return m.group(1)


# --- HTTP helpers ----------------------------------------------------------

def _http_get(url: str, timeout: float = 30.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


# --- core API --------------------------------------------------------------

def fetch_bug(url_or_token: str, *, download_assets: bool = False) -> Bug:
    """Fetch the bug metadata. If `download_assets` is True, also downloads
    each log file body and stores it on the asset.parsed field."""
    token = parse_token(url_or_token)
    raw = json.loads(_http_get(f"{API_BASE}/{token}"))
    if "bug" not in raw:
        raise LuciqError(f"Unexpected response shape: keys={list(raw)[:5]}")
    bug = Bug(token=token, raw=raw["bug"])
    bug.assets = _collect_assets(bug.raw)
    if download_assets:
        for a in bug.assets:
            if a.kind == "log" and not a.is_empty:
                a.parsed = _fetch_log(a.url)
    return bug


def _collect_assets(raw_bug: dict) -> list[BugAsset]:
    assets: list[BugAsset] = []
    state = raw_bug.get("state") or {}

    logs = state.get("logs") or {}
    for name in LOG_TYPES:
        entry = logs.get(name) or {}
        is_empty = bool(entry.get("is_empty_array", True))
        url = entry.get("url")
        if url:
            assets.append(BugAsset(name=name, url=url, kind="log", is_empty=is_empty))
        elif not is_empty:
            # Marked non-empty but missing url — keep a record so callers know.
            assets.append(BugAsset(name=name, url="", kind="log", is_empty=False))

    shot = (state.get("attachments") or {}).get("screenshot") or {}
    for variant in ("original", "big_thumb", "thumb"):
        url = shot.get(variant)
        if url:
            asset_name = "screenshot" if variant == "original" else f"screenshot_{variant}"
            assets.append(BugAsset(name=asset_name, url=url, kind="image"))

    return assets


def _fetch_log(url: str) -> Any:
    """Download a log file. Logs are typically JSON arrays; if parsing fails
    we return the raw text so callers can still read it."""
    body = _http_get(url)
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body.decode("utf-8", errors="replace")


def fetch_screenshot(bug: Bug, variant: str = "original") -> bytes:
    """Download the screenshot bytes. variant: original | big_thumb | thumb."""
    name = "screenshot" if variant == "original" else f"screenshot_{variant}"
    asset = bug.asset(name)
    if asset is None:
        raise LuciqError(f"Screenshot variant {variant!r} not available")
    return _http_get(asset.url)


def fetch_log(bug: Bug, log_type: str) -> Any:
    """Download a single log type by name."""
    asset = bug.asset(log_type)
    if asset is None:
        raise LuciqError(f"Unknown log type {log_type!r}; available: {LOG_TYPES}")
    if asset.is_empty:
        return []
    if not asset.url:
        raise LuciqError(f"Log {log_type!r} has no URL")
    return _fetch_log(asset.url)
