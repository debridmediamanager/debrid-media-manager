# Torznab Indexer Endpoint (Sponsor Indexer)

Base URL: `https://debridmediamanager.com/api/torznab` · API Path: `/api` · setup page: `/torznab`

DMM answers as a Torznab indexer for sponsors' own Prowlarr / Sonarr / Radarr, backed by
its own torrent library rather than by any upstream tracker. A result's download is a
magnet URI built from the infohash, so DMM is never in the grab path: the client resolves
the hash against its own debrid account.

This is the sibling of [the Newznab aggregator](newznab-aggregator.md) and deliberately
much smaller. That endpoint fans a search out to a fleet of paid Usenet accounts and
spends most of its design hiding which ones; this one has no upstream to hide and no
credential to protect, because an infohash is the thing the whole public site is built
out of. So there is no opaque release id, no proxied grab, no `t=get` and no NZB store.

Entry point: `src/pages/api/torznab/[...route].ts`. Supporting modules under
`src/services/torznab/`.

## Client configuration

| Field    | Value                                        |
| -------- | -------------------------------------------- |
| URL      | `https://debridmediamanager.com/api/torznab` |
| API Path | `/api` (the \*arr default)                   |
| API Key  | The sponsor's DMM API key from gatekeeper    |

Auth is the Newznab gate imported wholesale (`src/services/newznab/auth.ts`): `apikey=`
in the query string first, `x-api-key` as a fallback, resolved through
`Sponsors.dmmApiKey` with a live sponsorship check, answering 100 and 101 differently so
a lapsed sponsor is not left re-copying a key that was never the problem. Torznab shares
Newznab's credential codes, so nothing had to be re-specified.

The gate is not optional even though the library is publicly searchable on the site: an
open Torznab endpoint is a bulk export of the whole hash corpus in a machine-readable
format, which is the thing the anti-scraping work exists to prevent.

Because the key arrives in the query string, this route inherits the open reverse-proxy
follow-up the Newznab endpoint has: whatever redacts `apikey=` from access-log request
lines needs `/api/torznab/*` in its pattern list too, or sponsor keys land in the logs in
the clear.

## Feed variants live in the path

An \*arr appends `/api` to whatever URL it is given, so anything between `/api/torznab`
and that `/api` is ours to use:

| URL a sponsor pastes     | Feed                                                 |
| ------------------------ | ---------------------------------------------------- |
| `/api/torznab`           | Everything in the library, cached or not             |
| `/api/torznab/cached`    | Only releases cached on Real-Debrid **or** AllDebrid |
| `/api/torznab/rd`        | Cache signal read from Real-Debrid only              |
| `/api/torznab/ad`        | Cache signal read from AllDebrid only                |
| `/api/torznab/rd/cached` | Only what Real-Debrid already holds                  |
| `/api/torznab/ad/cached` | Only what AllDebrid already holds                    |

A query parameter would have been simpler and does not work: Prowlarr builds the query
string itself from the caps document and drops whatever a person put in the URL field.
An unrecognised segment answers error 202 rather than falling back to the plain feed —
`/api/torznab/realdebrid` looking like a working indexer that quietly answers a different
question is worse than an obvious failure.

## Operations (`t=`)

| `t`        | Auth | Purpose                                                                                                                      |
| ---------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `caps`     | none | Capabilities XML. Unauthenticated because Prowlarr fetches caps before it has a key. `Cache-Control: public, s-maxage=3600`. |
| `search`   | key  | Free-text (`q`, `cat`, `limit`, `offset`); with no `q` it is an RSS sync — see below.                                        |
| `tvsearch` | key  | TV (`q`, `imdbid`, `tvdbid`, `season`, `ep`).                                                                                |
| `movie`    | key  | Movies (`q`, `imdbid`).                                                                                                      |

There is no `t=get`. A Torznab item's download is its magnet.

`ep` is accepted and deliberately not acted on. Sonarr parses release titles itself and a
season pack is a correct answer to an episode search, so filtering the feed down to
titles that name the episode would hide every pack that contains it.

## Errors — Torznab XML, HTTP 200

Identical to the Newznab endpoint and for the same reason: several clients treat a
non-200 as an unreachable indexer without reading the body. Codes 100/101 (credentials,
lapsed sponsorship), 202 (no such function — also the body of the 405 for non-GET), 500
(request limit, sent with **HTTP 429** and `Retry-After`), 900 (top-level catch, because
a Next.js 500 is an HTML page).

## Rate limits

| Bucket          | Limit    | Keyed on                                  |
| --------------- | -------- | ----------------------------------------- |
| `torznabIp`     | 20 / 10s | client IP, before auth — the cheap reject |
| `torznabSearch` | 20 / min | `sponsor:<shortId>`                       |

No grab bucket exists, because a grab never comes back to DMM. Keying on `shortId` rather
than the key string means a gatekeeper key reset does not reset the budget and one
sponsor's whole \*arr farm shares one budget.

The same budget as the Newznab endpoint, though a search here costs DMM considerably
more: it reads whole library pages out of the database and classifies every hash in them
against the debrid caches, where a Newznab query is fanned out to upstream indexers.
Twenty a minute is a sustained search every three seconds across a whole \*arr
fleet; what it refuses is a burst, and a client that gets the 429 backs off on
`Retry-After` rather than treating the indexer as broken.

## Where the results come from

`runSearch` in `src/services/torznab/search.ts`:

1. `resolveTargets` (`resolve.ts`) turns the query into library page keys. An `imdbid`
   is normalized to the stored form — clients disagree about the `tt` prefix and Prowlarr
   strips the zero padding, and `tt111161` is a different title from `tt0111161`. A
   `tvdbid` is translated through MDBList (`resolveImdbIdFromTvdbId`), which is the only
   identifier Sonarr has for some series. A `q` goes through DMM's own local IMDb index,
   which also answers with the title's type — so a generic `t=search` for a show name
   reads season pages rather than a movie page.
2. Each page is read with `getScrapedTrueRow`, one row per key.
3. Reported hashes are dropped, exactly as the site does before rendering a title. A
   failure there serves the unfiltered set rather than failing the search.
4. Nothing found → debridio backfill (below).
5. Category filter, then the cache lookup, then paging (order matters — see below).

**Only `ScrapedTrue` is served.** The `Scraped` table has been measured carrying
fabricated titles filed against real hashes. A person browsing can see through that; an
\*arr cannot, because it matches on the release name and would import the wrong film.

### TV searches that name no season

DMM keys TV per season, so a search with no `season` has to pick a subset. It reads the
`MAX_UNSPECIFIED_SEASONS` (3) **most recently refreshed** season pages.

Recency rather than season number, and this is measured rather than assumed: mis-parsed
releases invent season pages that are never touched again. On 2026-09-06 `tt0903747` had
season keys up to **72**; its five real seasons were the five most recently updated,
holding 629–1710 releases each, while `:72`, `:71` and `:0` held three to fifteen and had
not moved in nine months. Ordering by season number answered a Breaking Bad search with
3 releases; ordering by recency answers it with 2,990.

A show with no pages at all resolves to season 1 — the one season every show has, and the
thing that gives the debridio backfill something to ask about rather than answering
empty.

### The untargeted feed (an \*arr's RSS sync)

A query naming nothing reads the `RECENT_KEYS` (8) most recently refreshed library pages
and takes `RECENT_PER_KEY` (5) releases from each. A library keyed by title has no
posting-date stream to offer; what it has is the titles whose release lists changed most
recently, which is the same set for the same reason.

This matters more than it looks: Prowlarr tests an indexer with exactly this request and
reports an empty answer as a **failed** test, so an indexer that answers nothing here
looks broken on setup. It never triggers a scrape.

### Debridio backfill

A page nothing has scraped yet falls through to `backfillFromDebridioNow` — the same call
`/api/torrents/movie` makes for the website. Debridio answers in about a second, so the
search is filled on that request instead of coming back empty. Only for a single, fully
named page: a query that resolved to several pages has no one thing to ask about. The
scrape is guarded by debridio's own in-flight marker and refresh window.

When a page _was_ served, `refreshDebridioAvailabilityInBackground` fires and is not
awaited — that is what keeps the cache markers this feed's `seeders` are made of fresh.

## What `seeders` means here

There is no swarm behind these releases in any sense a client would recognise. A grab is
resolved against the caller's own debrid account, so what decides whether it lands
instantly is whether the hash is already cached there, not how many peers are sharing it.
`seeders` is the only field a Torznab client ranks on, so that is what it carries:

| State                                | `seeders` |
| ------------------------------------ | --------- |
| Cached on the feed's debrid provider | 100       |
| Not cached                           | 1         |

Uncached is 1 rather than 0 on purpose: 0 means "dead" to an \*arr and gets the release
dropped, and DMM has no evidence any of these are dead. `peers` equals `seeders`.
`downloadvolumefactor` is 0 — nothing here is metered, so there is no ratio to keep. The
same signal orders the feed; see below.

Which cache is consulted follows the URL variant. The default reads both, so a sponsor
using only AllDebrid sees a Real-Debrid-cached release reported at 100; `/api/torznab/ad`
scopes the signal to their own provider.

## Categories

Derived, because a stored release is `{hash, title, fileSize}` and nothing more. The
parent comes from the page key (`movie:` → 2000, `tv:` → 5000) and is authoritative; the
subcategory is read off the resolution token in the release title. Both are always
emitted together, since an item carrying only `2040` is invisible to a client that asked
for `2000` — which is what Prowlarr's default mapping asks for.

A title with no resolution token gets its parent and nothing else. Labelling it SD would
be a guess, and a client that mapped only HD and UHD would drop it entirely. **Tell
sponsors to map the parent categories.**

There is no 5070/Anime entry even though the Newznab endpoint has one: the torrent
library carries no anime flag, so advertising it would only buy empty searches.

## `pubDate`

The library records no posting date. The date served is the library page's own
`updatedAt` — "when DMM last refreshed this title's release list" — which is a real
timestamp about real data rather than an invention. It cannot be omitted: an RSS parser
refuses a feed whose items carry no date at all (Sonarr throws `UnsupportedFeedException`
and reports the indexer as broken). A backfilled page is dated now, because that is when
those releases were found.

## Ordering and paging

`total` is the size of the whole matching set, and a client pages until it reaches it.

**Cached releases come first.** Measured against the live library, a plain movie search's
first hundred results were almost entirely 24-terabyte "Top 5000 Movies Pack" style
entries — the library is stored biggest-first, those packs are filed against individual
titles, and a client reads page one. Cached-first puts what the caller can actually grab
where the caller will actually look, and makes the order agree with the `seeders` the
same release is reported with. The sort is stable, so each group keeps the order its path
produced: size for a search, recency for an RSS sync.

That is why the cache lookup runs over the **whole** matching set rather than over the
page — the ordering depends on it, and a `/cached` feed's `total` and every page after
the first would be wrong if the filter were applied after slicing. Lookups are chunked at
500 hashes.

## Module map

| File                                  | Purpose                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| `src/pages/api/torznab/[...route].ts` | Dispatch, path variants, auth wiring, rate limits          |
| `src/services/torznab/resolve.ts`     | Query → library page keys (id normalization, TVDB, titles) |
| `src/services/torznab/search.ts`      | Library reads, debridio fallback, cache signal, paging     |
| `src/services/torznab/categories.ts`  | Category derivation and `cat=` matching                    |
| `src/services/torznab/xml.ts`         | Hand-rolled caps / RSS writers                             |
| `src/pages/torznab.tsx`               | Sponsor setup page (client gate is cosmetic)               |

Supporting additions elsewhere: `getScrapedTrueRow` / `getScrapedTrueSeasonKeys` /
`getRecentScrapedTrueKeys` (`services/database/scraped.ts`), `filterCachedHashes` /
`filterCachedHashesAd` (`services/database/availability.ts`), `getInfoByTvdbId`
(`services/mdblistClient.ts`) and `resolveImdbIdFromTvdbId` (`services/tvdbLookup.ts`).

## Environment

None. The endpoint needs no new configuration — no token secret, no public base, no
store — which also means there is no deploy step that can half-enable it. Debridio
backfill uses the `DEBRIDIO_ADDON_URL` / `DEBRIDIO_ALLDEBRID_URL` the site already sets,
and cleanly does nothing when they are unset.

## Tests

`src/test/api/torznabApi.test.ts` (endpoint behavior end to end),
`src/test/services/torznab{Resolve,Categories,Xml}.test.ts`,
`src/test/pages/torznab.test.tsx`.
