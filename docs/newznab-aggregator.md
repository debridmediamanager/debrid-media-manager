# Newznab Aggregator Endpoint (Sponsor Indexer)

Base URL: `https://debridmediamanager.com/api/newznab` · API Path: `/api` · setup page: `/newznab`

DMM answers as a single Newznab indexer for sponsors' own Prowlarr / Sonarr / Radarr /
SABnzbd, backed by a server-side fleet of upstream Usenet indexers. The response never
reveals which upstreams exist: an upstream `link` carries the operator's API key in its
`&r=` parameter, and even a bare qualified release id names the accounts DMM pays for —
so release ids are encrypted, enclosures point back at this endpoint, and no upstream
field is copied through. Every served NZB is rebuilt from a whitelist so per-download
indexer watermarks never leave the server.

Entry point: `src/pages/api/newznab/api.ts`. Supporting modules under
`src/services/newznab/`.

## Client configuration

| Field    | Value                                        |
| -------- | -------------------------------------------- |
| URL      | `https://debridmediamanager.com/api/newznab` |
| API Path | `/api` (the \*arr default)                   |
| API Key  | The sponsor's DMM API key from gatekeeper    |

Auth reads `apikey=` from the query string first (the Newznab convention — every \*arr
sends it there) and falls back to an `x-api-key` header. The key resolves through
`Sponsors.dmmApiKey` with a live sponsorship check, mirroring `api/zurg/auth.ts`
semantics: an unknown key and a lapsed sponsorship answer differently on purpose, so a
lapsed sponsor doesn't keep re-copying a "working" key forever.

## Operations (`t=`)

| `t`        | Auth | Purpose                                                                                                                                 |
| ---------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `caps`     | none | Capabilities XML. Unauthenticated because Prowlarr fetches caps before it has been given a key. `Cache-Control: public, s-maxage=3600`. |
| `search`   | key  | Free-text search (`q`, `cat`, `limit`, `offset`).                                                                                       |
| `tvsearch` | key  | TV search (`q`, `tvdbid`, `imdbid`, `season`, `ep`).                                                                                    |
| `movie`    | key  | Movie search (`q`, `imdbid`).                                                                                                           |
| `get`      | key  | Fetch one NZB by the opaque `id` token from a search result.                                                                            |

Query normalization (`normalizeSearchQuery` in `src/services/newznab/search.ts`):
`imdbid` loses its `tt` prefix unconditionally — some upstreams return zero results for
the prefixed form and the right ones for bare digits, which reads as a broken indexer
rather than a malformed query. `limit` caps at 100 (matching caps), malformed params are
dropped rather than forwarded.

## Errors — Newznab XML, HTTP 200

Errors are `<error code="…" description="…"/>` documents with **HTTP 200** (except rate
limits, below). Several clients treat any non-200 as an unreachable indexer without
reading the body, and SABnzbd shows the description when a grab fails — a 502 with a
JSON body reads to it as a corrupt download.

| Code | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| 100  | Incorrect user credentials (missing/unknown key)                                          |
| 101  | Sponsorship no longer active                                                              |
| 202  | No such function (unknown `t`; also the body of the 405 for non-GET)                      |
| 300  | No such item / release could not be downloaded                                            |
| 500  | Request limit reached (sent with **HTTP 429** + `Retry-After`)                            |
| 900  | Unknown error (top-level catch — a Next.js 500 is an HTML page, said in-protocol instead) |
| 910  | Function not available (`NEWZNAB_TOKEN_SECRET` unset — the endpoint fails closed)         |

Rate-limit refusals are the one deliberate exception to "always 200": they answer HTTP
429 **and** carry the Newznab error-500 body, so clients that honor status codes back
off and clients that only parse bodies still get the standard limit document. They must
never be JSON — an \*arr logs a JSON 429 as a broken indexer instead of backing off,
which is why this route is not wrapped in `withIpRateLimit`.

## Rate limits

Configured in `RATE_LIMIT_CONFIGS` (`src/services/rateLimit/middlewareRateLimiter.ts`),
enforced via `checkRateLimitFor` (`withRateLimit.ts`) — Redis sliding windows shared
across the swarm instances, in-memory per-instance fallback.

| Bucket           | Limit     | Keyed on                                                                                                                                            |
| ---------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `newznabIp`      | 20 / 10s  | client IP, before auth — the cheap reject; wider than the app default because a Sonarr interactive season search bursts faster than 5/s from one IP |
| `newznabSearch`  | 30 / min  | `sponsor:<shortId>`                                                                                                                                 |
| `newznabGrab`    | 10 / min  | `sponsor:<shortId>`                                                                                                                                 |
| `newznabGrabDay` | 150 / day | `sponsor:<shortId>`                                                                                                                                 |

Keying on `shortId` rather than the key string means a gatekeeper key reset does not
reset the budget, and one sponsor's whole \*arr farm shares one budget.

## Opaque release ids

`src/services/newznab/opaqueId.ts`. A release id is `${prefix}\n${nativeId}` encrypted
with AES-256-GCM under keys HKDF-derived from `NEWZNAB_TOKEN_SECRET`, with a
**synthetic IV**: the first 12 bytes of `HMAC-SHA256(ivKey, plaintext)` (SIV-style).
The token is `base64url(iv ‖ ciphertext ‖ tag)`.

Determinism is load-bearing, not cosmetic: the token doubles as the RSS `<guid>`, and
the \*arrs dedupe releases by guid across RSS syncs — a token that changed per response
would make every sync look like a feed of brand-new releases. Determinism leaks only
equality, which is exactly what a guid is for. `decryptReleaseId` additionally
re-derives the IV and compares it, so a non-canonical token under the same key is
rejected — one release, one guid, ever.

Consequence of the scheme being stateless: rotating `NEWZNAB_TOKEN_SECRET` invalidates
every guid and enclosure URL the \*arrs have stored.

## Search flow

`runSearch` in `src/services/newznab/search.ts`:

1. Cache check (below). Fresh entry → page and return, zero upstream calls.
2. Fan out one URL per configured upstream (`NEWZNAB_INDEXERS` env JSON, parsed by
   `src/services/newznab/indexers.ts`) through `fanOut` from `services/nzb2rd.ts` —
   best-effort parallel; one refusal never empties the result. Upstreams are always
   asked for a full page of 100 regardless of the client's `limit`, so a small request
   cannot poison the cache with an unpageable set.
3. Per-upstream outbound pacing: an indexer configured with `pacing` is checked against
   its own limiter bucket _before_ being included and skipped for this query when over
   budget — checked before, not after, because some upstreams answer a burst with their
   own "Request limit reached", which Sonarr turns into a 24h backoff.
4. `dedupeResults` (normalized-title-only — measured; size-based dedup false-merges).
5. Rewrite every item: `guid` = encrypted token (`isPermaLink="false"`), `enclosure`
   pointing at this endpoint's own `t=get` carrying the **caller's** apikey (SAB/NZBGet
   fetch enclosures verbatim with no auth of their own; an unauthenticated `t=get`
   would let a leaked token drain grab budgets), `newznab:attr` whitelist of `size` and
   `category` only, `pubDate` passed through or omitted — never fabricated. The
   enclosure origin comes from `NEWZNAB_PUBLIC_BASE`, never the request's Host header
   (stored and replayed by the \*arr for days; spoofable).
6. Cache the full merged pre-offset set (even when empty), slice by `offset`/`limit`.

Total upstream outage falls back to a stale cache entry rather than answering empty —
an \*arr reads an empty feed as "these releases are gone".

## Search cache

`src/services/database/newznabApiCache.ts`, generic Cache KV table, prefix `nzbapi:v1:`.
The key is the sorted normalized params **excluding** `limit`/`offset` — the entry holds
the full merged set, so every page of a result is served from the one entry the first
page wrote.

TTL is computed **at read time** from the newest `pubDate` in the cached set (so tier
tuning takes effect on deploy for existing entries), on the theory that the newest
pubDate measures how recently releases for this content are still being posted:

| Newest release posted | TTL  |
| --------------------- | ---- |
| < 30 days             | 12 h |
| 30–90 days            | 3 d  |
| 90 days – 1 year      | 7 d  |
| 1–3 years             | 21 d |
| > 3 years             | 45 d |
| no parseable pubDates | 24 h |
| empty result set      | 1 h  |

One cap on top: a query naming no title and no id (no `q`/`imdbid`/`tvdbid`) is an \*arr
RSS sync — "what's new" — whose results are always freshly posted, so the age tiers
alone would hold it for 12h and every sponsor would see new releases half a day late.
Those reads are capped at 15 minutes (`RSS_TTL_MS`).

## Grab flow (`t=get`)

1. Decrypt the token; any tamper or garbage → error 300.
2. Per-key grab limits (both buckets).
3. **Read-through NZB store** (`src/services/newznab/store.ts`): a hit serves the
   stored, already-cleaned NZB — zero upstream calls, and it works even if the upstream
   indexer is dead or has been removed from the config (which is why the store check
   precedes indexer resolution).
4. Miss: resolve the indexer by prefix, `fetchNzbFrom` (keeps the HTTP-200
   error-envelope check and redirect-following from `services/nzb2rd.ts`), sanitize,
   write the cleaned XML to the store best-effort (a write failure logs and still
   serves), serve.
5. Response: `Content-Type: application/x-nzb`, RFC-5987 dual-filename
   `Content-Disposition`, and `X-Nzb-Removed` describing what sanitization stripped
   (`-` on a store hit). Grab failures answer error 300 with a generic description —
   the underlying error names the upstream, which is exactly what this endpoint
   withholds; the real message is logged server-side.

The store is an object store reached over Backblaze B2's native HTTP API (hand-rolled
over `fetch`, no SDK dependency — token auth, no request signing). Objects are keyed
`nzb/<prefix>/<encoded nativeId>.nzb`; only the **cleaned** artifact is ever written,
so the watermarked upstream original never exists at rest anywhere. Missing `B2_*` env
cleanly disables the store: both entry points return miss/failure without a network
call and every grab falls through to the upstream fetch. Any store failure degrades to
a cache miss — a storage outage never fails a grab. A small metadata entry per stored
release lives in the Cache KV under `nzbstore:v1:` (sizes, counts, what was removed,
fetch count).

## NZB sanitization

`src/utils/nzbSanitize.ts` — a whitelist rebuild, not a strip-list (see the module
docstring for the measured watermarks that motivated it). For this endpoint it also
preserves the `name`/`title` (normalized to `name`), `category`, and `password` head
metas — per-release rather than per-download, and the password meta is load-bearing for
upstreams that serve header-encrypted RAR releases with the password in the NZB — and
flags (never drops) files whose summed segment bytes fall under 4 KB
(`plantedSuspects`): a genuine Usenet file is never that small; a planted one-segment
watermark article is.

## Module map

| File                                       | Purpose                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `src/pages/api/newznab/api.ts`             | Dispatch, auth wiring, rate limits, grab flow                          |
| `src/services/newznab/auth.ts`             | `apikey`/header → sponsor lookup, 100 vs 101                           |
| `src/services/newznab/search.ts`           | Normalization, cache, fan-out, pacing, item rewrite                    |
| `src/services/newznab/indexers.ts`         | `NEWZNAB_INDEXERS` env JSON → upstream list                            |
| `src/services/newznab/opaqueId.ts`         | Deterministic encrypted release ids                                    |
| `src/services/newznab/xml.ts`              | Hand-rolled caps / RSS / error writers                                 |
| `src/services/newznab/store.ts`            | B2 read-through store for cleaned NZBs                                 |
| `src/services/database/newznabApiCache.ts` | Age-scaled search cache                                                |
| `src/pages/newznab.tsx`                    | Sponsor setup page (client gate is cosmetic; the API is the real gate) |

## Environment

`NEWZNAB_INDEXERS` (JSON array of `{prefix, name, url, apiKey, keyless?, pacing?}` —
`url` is the full API endpoint including any non-standard api path),
`NEWZNAB_TOKEN_SECRET` (64 hex chars; unset ⇒ the endpoint answers 910),
`NEWZNAB_PUBLIC_BASE`, `B2_KEY_ID` / `B2_APP_KEY` / `B2_BUCKET` (optional — store
disabled without them). Documented with rationale in `.env.example`.

## Tests

`src/test/api/newznabApi.test.ts` (endpoint behavior — including the identity-stripping
regression that greps a whole response for upstream hostnames, keys and id prefixes),
`src/test/services/newznab{OpaqueId,Indexers,Xml,RateLimit,Store,ApiCache}.test.ts`,
`src/test/pages/newznab.test.tsx`, plus the parser/sanitizer additions in
`src/services/nzb2rd.test.ts` and `src/utils/nzbSanitize.test.ts`.
