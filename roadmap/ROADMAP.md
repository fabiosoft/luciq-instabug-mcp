# Roadmap

Prioritized list of features to add to `luciq-instabug-mcp`, ordered from
most necessary to least. Priority is driven by impact on agent UX, payload
size and server robustness — not by implementation effort.

The current service exposes 6 MCP tools (`list_log_types`, `get_bug`,
`get_device_info`, `get_log`, `get_all_logs`, `get_screenshot`) plus the
mirroring REST routes. Most items below extend that surface; a few are
infrastructure (cache, auth, metrics).

---

## P0 — Critical (ship first)

These three address the biggest pain points today: every tool re-fetches
the same payload, agents drown in 200 KB log dumps, and there is no quick
way to triage a bug without pulling everything.

### 1. In-memory cache for `fetchBug`
- TTL ~15 minutes, keyed by token.
- In-flight request dedupe (single concurrent fetch per token).
- Touches every tool: `get_bug`, `get_device_info`, `get_log`,
  `get_all_logs`, `get_screenshot` all call `fetchBug` independently
  today.
- Must be a no-op on stateless runtimes (Cloudflare Pages function,
  Vercel function) — keep it process-local, document the limitation.

### 2. `summarize_bug(token)` tool
- Returns a compact triage payload: device info, last N `user_steps`,
  last errors from `console_log`/`instabug_log`, failed network calls
  (status ≥ 400), counts per log type.
- Single tool call replaces the typical
  `get_device_info` + `get_log(user_steps)` + `get_log(network_log)` +
  `get_log(console_log)` chain.
- Designed to fit in <8 KB so it stays cheap in agent context.

### 3. `search_logs(token, query, log_types?)` tool
- Full-text / regex search across one or more log types.
- Paginated results with surrounding context (line / entry index +
  snippet).
- Replaces today's pattern of dumping `get_all_logs` and grepping
  client-side, which blows up the agent context window.

---

## P1 — High value

Targeted log queries and structured network filtering. These are the
features users will reach for once they stop using `get_all_logs`.

### 4. `filter_network_log(token, filters)`
- Structured filters: `status`, `method`, `host`, `min_duration_ms`,
  `contains` (body/url substring).
- Returns only matching entries, with summary counts.
- Most network logs are noise — this is where the size problem lives.

### 5. `get_timeline(token)` tool
- Chronological merge of `user_steps` + `instabug_log` + `console_log`
  + network events, sorted by timestamp.
- One ordered stream is far easier to reason about than four parallel
  ones.

### 6. `get_errors(token)` tool
- Mirrors `summarize_bug` but error-only: stack traces, exceptions,
  `error` / `fatal` log levels, network ≥ 400.
- Useful for "what broke?" queries without any extra context.

### 7. Pagination on `get_log`
- `offset` + `limit` parameters (REST and MCP).
- Default cap (e.g. 200 entries) when omitted.
- Keeps `get_log` viable on large bugs without forcing callers to
  switch to `search_logs`.

### 8. Retry with backoff on upstream fetches
- 502 / 503 / 504 from CloudFront and request timeouts retried up to
  3× with exponential backoff + jitter.
- Currently a single transient failure surfaces as a tool error.

---

## P2 — Operational hardening

Needed before the service is exposed publicly with any meaningful
traffic. Lower priority because the project is currently a hobby /
single-user deploy.

### 9. Optional auth (`MCP_API_KEY`)
- Bearer token check on `/mcp` and `/bugs/*` when the env var is set.
- No-op when unset, so local Docker / dev keep working unchanged.

### 10. Per-IP rate limit
- Token-bucket on the REST surface and `/mcp`.
- Standard `X-RateLimit-*` response headers.
- Protects the upstream `api.luciq.ai` from being abused through us.

### 11. Structured logging (pino)
- Honor `LOG_LEVEL` (already documented in the README).
- Request id propagated through the Hono app and into client errors.

### 12. Prometheus metrics on `/metrics`
- Per-tool latency histogram, cache hit/miss, upstream error rate.
- Single counter for "logs bytes returned" — the metric most worth
  watching.

### 13. CloudFront host allowlist in `client.ts`
- Defense-in-depth: reject any asset URL that does not match the
  expected CloudFront / Luciq host pattern.
- Cheap insurance against a future change in the upstream payload
  shape.

---

## P3 — DX and output formats

Quality-of-life improvements for humans consuming the data, and richer
ways to plug the service into existing tools.

### 14. Markdown report endpoint
- `GET /bugs/<token>/report.md` — metadata, inline screenshot, top
  errors, key timeline entries.
- Pasteable into Jira / GitHub / Linear with no further processing.

### 15. HAR export for `network_log`
- `GET /bugs/<token>/network.har` — opens directly in Chrome DevTools
  and Proxyman.
- Lets developers replay / inspect requests with familiar tooling.

### 16. NDJSON export for logs
- `GET /bugs/<token>/logs/<type>.ndjson` — streaming-friendly format,
  greppable line-by-line.

### 17. OpenAPI spec + landing-page "try it"
- Auto-generated from the Hono routes.
- Served at `/openapi.json` with a minimal Swagger UI mount.

---

## P4 — Multi-bug workflows

Useful once a user has more than one report at a time. Lower priority
because the typical flow today is "investigate one bug end-to-end".

### 18. `compare_bugs(tokens[])` tool
- Side-by-side device info, app versions, error patterns.
- Detects whether the same crash recurs across reports.

### 19. Batch CLI mode
- `cli.ts <token1> <token2> ...` with bounded concurrency and one
  output directory per bug.
- Currently the CLI is single-token only.

---

## P5 — MCP-native extensions

Polish that only matters once everything above is in place, but makes
the server feel idiomatic to MCP clients.

### 20. MCP Resources (`luciq://bug/<token>/...`)
- Bugs, individual logs and the screenshot exposed as resources, not
  just tools.
- Lets agents pin a bug into their context window persistently.

### 21. MCP Prompts
- Pre-canned prompts (e.g. *"triage this bug"*, *"find the root cause
  from logs and screenshot"*) that orchestrate the tools in the right
  order.
- Lowers the bar for non-expert agent users.

### 22. Server-side `download_bug(token, out_dir)` tool
- Mirrors what `cli.ts` does today, but callable over MCP / REST.
- Lets agents snapshot a bug before the ~3-week CloudFront URLs
  expire.

---

## Out of scope (for now)

- Anything that requires authenticating against Luciq private APIs —
  this project only consumes the public-share endpoint.
- Persistent storage / database — keeps deploy simple across Docker,
  Vercel and Cloudflare Pages.
- Multi-tenant features (per-user quotas, audit logs) — revisit only
  if the service is ever offered as SaaS.
