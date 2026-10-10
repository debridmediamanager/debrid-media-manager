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

| URL a sponsor pastes     | Feed                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `/api/torznab`           | Everything in the library, cached or not                               |
| `/api/torznab/cached`    | Only releases cached on Real-Debrid **or** AllDebrid                   |
| `/api/torznab/rd`        | Cache signal read from Real-Debrid only, minus what RD refuses by name |
| `/api/torznab/ad`        | Cache signal read from AllDebrid only                                  |
| `/api/torznab/rd/cached` | Only what Real-Debrid already holds and will hand over                 |
| `/api/torznab/ad/cached` | Only what AllDebrid already holds                                      |

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

With `season` and `ep` together, a TV search answers for that one episode — see
**Episode searches** below.

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

Tighter than the Newznab endpoint's 30, because a search here costs DMM considerably
more: it reads whole library pages out of the database and classifies every hash in them
against the debrid caches, where a Newznab query is fanned out to upstream indexers.

The budget counts **requests, not searches**, and an \*arr spends one per page (see
**Ordering and paging**). A 429 partway through a search is not a pause: Sonarr and
Radarr throw out every page that search had already read, show the search as empty and
bench the indexer for `Retry-After` or longer. So the page size and this budget have to
be sized together. dmm-01's proxy log for 2026-09-06 to 2026-10-03 holds 566,489 \*arr
requests, about 73,000 searches. Replayed against this limiter (the replay refuses
22,295 requests where the log recorded 21,561), with each search re-paged at 100:

| Page size | Budget   | \*arr searches refused before they finished |
| --------- | -------- | ------------------------------------------- |
| 10        | 20 / min | 8.8%, as logged                             |
| 100       | 20 / min | 0.2%                                        |
| 100       | 25 / min | 0.02%                                       |

At a hundred a page a search no longer spends the budget on its own; what is left is
almost entirely three or more searches from one key inside a minute, which is the burst
this budget exists to pace.

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
3. Nothing found → debridio backfill (below).
4. An episode search keeps the releases that name that episode (below).
5. Reported hashes are dropped, exactly as the site does before rendering a title. A
   failure there serves the unfiltered set rather than failing the search.
6. On a movie page, releases the scraped-result verdicts judged not to be that movie are
   dropped, as the movie page does (see below).
7. Category filter, then the cache lookup, then paging (order matters — see below).

**Only `ScrapedTrue` is served.** The `Scraped` table has been measured carrying
fabricated titles filed against real hashes. A person browsing can see through that; an
\*arr cannot, because it matches on the release name and would import the wrong film.

### Releases judged not to be the movie

A movie page view runs the scraped-result verdict pass (`src/services/scrapedVerdicts/`),
which moves releases that are not the movie off the page into `ScrapedTrash`. A scraper
that finds one of them again merges it back into `ScrapedTrue`, and until something moves
it again every reader of the page serves it. On 2026-10-04, 27 of 393 randomly drawn
judged movie pages held 137 such releases. Two things now cover that window:

- The feed drops every release on a movie page that already carries a trash verdict,
  through the same `withoutTrashedResults` the movie page uses, on searches and on the
  RSS sync. The verdicts are keyed by the title as stored, so the filter runs before the
  titles are decoded. It follows the verdicts' own switch: with no `TYPESAFE_API_KEY` it
  passes everything through, and a failed lookup serves the page unfiltered.
- The cron's sweep (`sweep.ts`) moves those releases off the pages a scraper changed,
  without a page view and without asking the model.

A Torznab search does not start a verdict pass. The pass spends the model budget, which
page views alone used up on every day from 2026-09-28 to 2026-10-03, so a feed read
would only move that budget from the pages people open to the ones an \*arr asks about.
Releases nobody has judged yet are served as before.

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

### Episode searches

A `tvsearch` naming `season` and `ep` is answered with the releases whose title names that
episode of that season: alone (`S03E10`, `3x10`) or in a multi-episode release that covers
it (`S03E09E10`, `S03E01-E10`). Season packs, other episodes and other seasons are left out.
`episodeFilter` in `search.ts` does this before the cache lookup, so `total` names the
episode's set and the cache is only asked about it.

Season packs are left out because Sonarr refuses them there. From Sonarr's source
(v4.0.20.3012), `SingleEpisodeSearchMatchSpecification` rejects, on a search for one
episode, a release from another season (`Wrong season`), one that names no episode
(`Full season pack`), and one whose episodes leave the searched one out (`Wrong episode`).
A multi-episode release that includes it passes. Packs are still served where Sonarr takes
them: its season search sends `season` without `ep`, and that request is unfiltered.

Until 2026-10-03 `ep` was accepted and ignored, so an episode search returned the whole
season and Sonarr's thousand-release cutoff applied to the season instead of the episode.
The reported Sonarr search for Silo S03E10 read a season page DMM served as 1,432
releases. 105 named episode 10, and 33 of those came after the thousandth release, so
Sonarr never saw them. The other 1,327 named another episode, a pack or another season,
all of which Sonarr refuses. Now the same search is 105 releases in two requests. Episode
searches were 17,786 of the 72,883 \*arr searches in dmm-01's proxy log from 2026-09-06 to
2026-10-03.

The title is read by the season page's own reader (`parseTvEpisode` in
`src/utils/tvEpisodes.ts`, built on `seasonNaming`), not by `ptt`, which reads episode 2
out of `2xRus` and called 42% of a 4,498-title corpus's season packs single episodes. The
reader has no episode counts here, so `S03E01-E10` stays a range covering episode 10 rather
than becoming a pack. Sonarr reads it the same way. Three cases are answered as before:

- **Season 0.** Sonarr also maps a release to a special by the episode's title
  (`ParseSpecialEpisodeTitle`), and that title need not name `S00E05`.
- **A daily show.** Its `ep` is a date (`ep=10/03`), which is not an episode number.
- **Anime by absolute number.** Sonarr's anime episode search also asks with `q=46` and
  no `season` or `ep`. That request reads the show's recent season pages whole, so a fansub
  release numbered across the whole run (`Show - 46`) still reaches it. Only the
  standard-format request that names `season` and `ep` is filtered.

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

### Releases Real-Debrid refuses by name

Real-Debrid refuses some releases by name whether or not it already holds them: an add is
judged on the torrent's own name and an unrestrict on each file's name. The rule is
`isRdBlockedName` in `src/utils/deInfringe.ts` (eleven strings in any case, measured
2026-10-10); the feed only decides which names to give it. Reported 2026-09-08:
`/api/torznab/rd/cached` listed `Dead.Of.Winter.2025.2160p.AMZN.WEB-DL.DDP5.1.H.265-FLUX`,
which DMM's RD table marked downloaded, and RD refused it.

- A release is judged on its library title **and** on the two names its `Available` row
  records (`originalFilename`, the torrent's own name, and `filename`, the selected file's
  when one file was selected). The title alone is not enough: across the 7,497 RD-held
  hashes on the 300 most recently refreshed pages on 2026-10-03, 224 carried a refused
  name on their RD row under a title that hid it, mostly a listing writing `WEB-DL` as
  `WEB DL`.
- `/api/torznab/rd` and `/api/torznab/rd/cached` leave such a release out, held or not:
  an RD account can never take it.
- `/api/torznab` and `/api/torznab/cached` keep it, but RD holding it no longer counts as
  cached; AllDebrid holding it still does.
- The AllDebrid and provider-probed feeds are unchanged; those services apply no such
  rule.

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

`caps` advertises `<limits max="100" default="10"/>`: `MAX_LIMIT` and `DEFAULT_LIMIT` in
`src/services/torznab/xml.ts`. A larger `limit` is clamped, not refused, and a client
that names none gets ten. `total` is the size of the whole matching set, not of the page.

**How an \*arr pages**, from Sonarr's and Radarr's source (`HttpIndexerBase.FetchReleases`,
`NewznabRequestGenerator.GetPagedRequests`, `Torznab.GetProviderPageSize`): the page size
is the larger of `default` and `max`, never above 100; pages are asked for by offset two
seconds apart; paging stops at a page shorter than that size, at 30 pages or at 1,000
releases. `total` is never read. Prowlarr does no paging of its own: it forwards the
app's `offset` and `limit` as one request, and passes DMM's `default` and `max` through
to the app's caps, so an app behind Prowlarr pages the same way. The apps and Prowlarr
each cache caps for up to seven days, so a change here reaches a running \*arr after that
or on its restart.

Every page is a full search on DMM's side — there is no response cache on this path —
and a request against the budget in **Rate limits** above. That is why `max` is 100. From
2026-09-08 to 2026-10-03 it was 10, and every title with more than 200 matching releases
was unsearchable from an \*arr: twenty pages two seconds apart spend the whole budget in
40 seconds, and the twenty-first is refused. The reported case (2026-09-17) was a Sonarr
episode search refused on `offset=200&limit=10`, on a season page that held 1,503 releases
by 2026-10-03; at 100 a page a search of that whole season is ten requests. The episode
search itself is now two requests, because `ep` is read (see **Episode searches**).
`default` stays at ten so that a client which reads only page one, and names no limit, is
not handed what it will not look at.

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
and cleanly does nothing when they are unset. The verdict filter follows the verdicts'
existing switch, `TYPESAFE_API_KEY`, and passes everything through without it.

## Tests

`src/test/api/torznabApi.test.ts` (endpoint behavior end to end; its Real-Debrid name cases
run on `src/test/fixtures/torznab/rd-refused-names-2026-10-03.json`, two whole production
library pages with their RD rows, and on RD's recorded probe answers in
`src/test/fixtures/realdebrid/rd-name-filter-2026-10-10.json`; its paging cases run a model
of Sonarr's paging through the route and the real limiter against
`src/test/fixtures/torznab/sonarr-episode-search-2026-09-17.json`, the reported search as
the proxy log recorded it plus the production library page it paged through, and the same
fixture checks that the reported S03E10 search returns every release naming that episode
inside Sonarr's reach; its verdict cases serve a recorded movie page whose trashed releases
a scraper wrote back, `src/services/scrapedVerdicts/__fixtures__/written-back-trash.json`),
`src/test/services/torznab{Resolve,Categories,Xml}.test.ts`,
`src/test/pages/torznab.test.tsx`.
