# Privacy Policy

_Last updated: 2026-05-07_

**luciq-instabug-mcp** ("the Service") is an unofficial, open-source hobby
project that relays publicly accessible **Luciq** (formerly Instabug) bug
reports as JSON, REST, and MCP. It is **not affiliated with, endorsed by, or
sponsored by Luciq / Instabug**. This notice describes how personal data is
handled by the reference deployment.

---

## 1. Controller

For self-hosted deployments, the operator who runs the binary is the
controller for that instance.

## 2. What the Service does (and does not do)

The Service is **stateless**. On each request it:

1. Receives a Luciq share token (or full `dashboard.luciq.ai/bugs/<token>`
   URL) supplied by the caller.
2. Forwards a request to the public Luciq API
   (`https://api.luciq.ai/api/web/public/bugs/<token>`) and, when needed,
   downloads the signed CloudFront assets referenced in the response (logs,
   JPEG screenshot).
3. Streams the result back to the caller.

The Service:

- Has **no user accounts**, no login, no cookies, no analytics.
- **Does not persist** bug data, logs, screenshots, request bodies, or
  responses to any database, cache, or disk on the server.
- **Does not sell, share, or transfer** any data to third parties beyond the
  upstream Luciq API needed to fulfill the request.

## 3. Data processed in transit

| Category | Source | Purpose | Retention |
|---|---|---|---|
| Luciq share token | URL path / query / MCP arg | Look up the bug on api.luciq.ai | Not stored — held in memory for the request |
| Bug payload (metadata, logs, screenshot) | api.luciq.ai → us → caller | Relay to caller | Not stored |
| Caller IP address, User-Agent, request path | Inbound HTTP request | Diagnostics, abuse prevention | Server access logs (see §4) |

Bug reports authored through Luciq may contain personal data of end-users of
the originating application (names, emails, device IDs, screen content, IP
addresses, free-text feedback). The Service **transports** this data but
does not control or curate it. The original application publisher remains
the controller of that data; lawful basis for accessing a given bug token is
the responsibility of the caller.

## 4. Server logs

Depending on the hosting environment, short-lived access logs may exist:

- **Docker / self-host:** stdout logs containing timestamp, method, path,
  status. Token values are part of the URL path and will appear in those
  lines unless the operator strips them. Retention is whatever the
  operator's `docker logs` / log driver is configured for.
- **Vercel / Cloudflare Pages:** the platform retains its own request logs
  per its own privacy terms. See:
  - Vercel: https://vercel.com/legal/privacy-policy
  - Cloudflare: https://www.cloudflare.com/privacypolicy/
- **MCP stdio transport:** runs locally on your machine, no remote logs.

Operators who consider Luciq tokens or caller IPs sensitive should configure
log redaction at the reverse-proxy or hosting layer.

## 5. Third parties

- **api.luciq.ai / dashboard.luciq.ai / Luciq CloudFront**: every request to
  the Service triggers an outbound request to Luciq infrastructure to
  fetch the bug. Luciq's privacy policy applies to that exchange.
- **Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`)**: the public
  landing page (`/`) loads Fraunces and JetBrains Mono from Google. This
  exposes the visitor's IP and User-Agent to Google. The landing page is
  cosmetic; the API and MCP endpoints do not load it.
- No advertising, no tag managers.

If self-hosting in the EU and you wish to avoid any Google Fonts transfer,
self-host the font files or remove the `<link>` tags in
[`src/assets.ts`](src/assets.ts).

## 6. Cookies and local storage

The Service sets **no cookies** and writes nothing to the client's local
storage.

## 7. International transfers

The reference deployment may run on Vercel or Cloudflare edge networks,
which route traffic globally. Outbound calls to Luciq and CloudFront also
cross borders. Each operator should evaluate whether their deployment
region and these transfers are compatible with their obligations.

## 8. Your rights (GDPR / CCPA)

Because the Service stores nothing, there is no on-server record to access,
rectify, port, or delete.

- For personal data **contained inside Luciq bug reports**, contact the
  application publisher who collected the bug, or Luciq / Instabug directly.
- For personal data in **server access logs** of a specific deployment,
  contact that deployment's operator.

## 9. Security

- Transport is HTTPS in the hosted reference deployment; self-hosted users
  are responsible for terminating TLS.
- No long-lived secrets are required to use the Service. The upstream Luciq
  share tokens are sensitive — anyone holding a token can fetch the
  associated bug. Treat them as you would any unguessable URL.

## 10. Changes

This policy may be updated; the date at the top reflects the most recent
revision. Material changes will be noted in the project changelog.
