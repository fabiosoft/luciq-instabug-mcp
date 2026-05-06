#!/usr/bin/env python3
"""CLI to download a Luciq public bug report (logs + screenshot).

Usage:
    python luciq_fetch.py <url-or-token> [-o OUTPUT_DIR] [--no-screenshot]
                                         [--logs name,name,...]

Examples:
    python luciq_fetch.py https://dashboard.luciq.ai/bugs/<TOKEN>
    python luciq_fetch.py <TOKEN> -o ./out
    python luciq_fetch.py <token> --logs instabug_log,network_log
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from luciq_client import LOG_TYPES, LuciqError, fetch_bug, fetch_log, fetch_screenshot


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Download a Luciq public bug report.")
    p.add_argument("target", help="Public dashboard URL or bare bug token")
    p.add_argument("-o", "--output-dir", default=None,
                   help="Output dir (default: ./bug-<number>)")
    p.add_argument("--no-screenshot", action="store_true",
                   help="Skip screenshot download")
    p.add_argument("--logs", default=None,
                   help=f"Comma-separated log types to fetch (default: all). "
                        f"Choices: {','.join(LOG_TYPES)}")
    p.add_argument("--quiet", "-q", action="store_true")
    args = p.parse_args(argv)

    log = (lambda *a, **k: None) if args.quiet else print

    try:
        bug = fetch_bug(args.target)
    except LuciqError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    out = Path(args.output_dir) if args.output_dir else Path(f"bug-{bug.number}")
    out.mkdir(parents=True, exist_ok=True)
    log(f"Bug #{bug.number} — {bug.title!r} [{bug.app_slug}]")
    log(f"Output: {out.resolve()}")

    (out / "bug.json").write_text(json.dumps(bug.raw, indent=2, ensure_ascii=False))
    log("  wrote bug.json")

    requested = (
        [s.strip() for s in args.logs.split(",") if s.strip()]
        if args.logs else list(LOG_TYPES)
    )
    logs_dir = out / "logs"
    logs_dir.mkdir(exist_ok=True)
    for name in requested:
        if name not in LOG_TYPES:
            log(f"  skip unknown log type: {name}")
            continue
        asset = bug.asset(name)
        if asset is None or asset.is_empty:
            log(f"  skip {name} (empty)")
            continue
        try:
            data = fetch_log(bug, name)
        except LuciqError as e:
            log(f"  skip {name}: {e}")
            continue
        path = logs_dir / f"{name}.json"
        if isinstance(data, (dict, list)):
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        else:
            path = logs_dir / f"{name}.txt"
            path.write_text(str(data))
        log(f"  wrote {path.relative_to(out)} ({path.stat().st_size} bytes)")

    if not args.no_screenshot and bug.asset("screenshot"):
        try:
            png = fetch_screenshot(bug, "original")
        except LuciqError as e:
            log(f"  screenshot: {e}")
        else:
            shot_path = out / "screenshot.jpg"
            shot_path.write_bytes(png)
            log(f"  wrote {shot_path.name} ({len(png)} bytes)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
