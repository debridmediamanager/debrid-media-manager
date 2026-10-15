# Metadata API

An open API for reading what metadata sources say about a movie or show, one title at a
time. Any server can provide it and any client can read it: a **provider** answers with
each of its sources' own records for a title, and a **client** (a media server naming the
files in its library, a scraper, an indexer) reads the sources it knows.

DMM is one provider, for its sponsors ([below](#dmms-provider)). The rex media server is
one client; it reads TMDB's records through a provider when one is configured
(`REX_METADATA_URL`) and from TMDB itself otherwise. Another provider can be a cache in
front of TMDB, a mirror, or a service built on other databases.

## Naming a title

| Id               | Title                                     |
| ---------------- | ----------------------------------------- |
| `imdb:tt0852863` | IMDb's id: a movie, a show, or an episode |
| `tmdb:tv:1877`   | TMDB's show                               |
| `tmdb:movie:603` | TMDB's movie                              |

TMDB numbers movies and shows separately (movie 155 is The Dark Knight, show 155 is 3rd Rock
from the Sun), so a TMDB id carries its kind. A provider may accept more schemes and should
answer 400 for one it does not.

## `GET /api/metadata/<id>`

```bash
curl -H "x-api-key: $KEY" \
  'https://provider.example/api/metadata/tmdb:tv:2085?season=2&sources=tmdb'
```

```json
{
	"ids": { "imdb": "tt0220880", "tmdb": 2085, "tvdb": 77435 },
	"merged": null,
	"sources": {
		"tmdb": {
			"id": 2085,
			"name": "Courage the Cowardly Dog",
			"seasons": [],
			"external_ids": {},
			"credits": {}
		},
		"tmdbSeason": {
			"season_number": 2,
			"episodes": [{ "episode_number": 1, "name": "The Magic Tree of Nowhere" }]
		}
	},
	"type": "show"
}
```

| Query          | Meaning                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `season=N`     | Add `sources.tmdbSeason` for a show: that season's episode list                                                                 |
| `episode=N`    | With `season`: add `sources.tmdbEpisode`, that episode                                                                          |
| `sources=tmdb` | Answer TMDB's records alone. For a client reading many seasons in a row: the provider need not ask every other source each time |

| Field     | Meaning                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `ids`     | Every id the provider knows the title by: `imdb`, `tmdb`, `tvdb`, more if it has them                  |
| `type`    | `movie`, `show` or `episode`                                                                           |
| `merged`  | The provider's own merge of its sources, in a shape it documents, or `null`                            |
| `sources` | Each source's answer **in that source's own shape**; `null` where it failed or does not know the title |

`sources` is open: a provider names its sources as it likes and adds any it has, and a
client ignores the ones it does not know. A source's answer is never reshaped, so a client
written against that source's own API reads it unchanged.

These names have a fixed meaning. Each holds exactly what TMDB's v3 API answers for the
request beside it:

| Source        | TMDB request                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmdb`        | `/movie/{id}` or `/tv/{id}`, appending at least `external_ids` and `credits`, plus `release_dates` for a movie and `content_ratings` for a show |
| `tmdbFind`    | `/find/{imdb id}?external_source=imdb_id`, for an `imdb:` id                                                                                    |
| `tmdbSeason`  | `/tv/{id}/season/{N}`, when `season` is asked                                                                                                   |
| `tmdbEpisode` | `/tv/{id}/season/{S}/episode/{N}?append_to_response=external_ids`, when `episode` is asked                                                      |

Other sources with a name of their own here: `trakt` (Trakt's `/movies|shows/{id}?extended=full`),
`traktSeasons`, `traktNext`, `traktLast`, `mdblist`, `cinemeta`, `omdb`, `tvmaze`. A provider
that adds a source should name it after the service and keep its shape.

## `GET /api/metadata/search`

```bash
curl -H "x-api-key: $KEY" \
  'https://provider.example/api/metadata/search?query=Phineas%20and%20Ferb&type=show&year=2007'
```

```json
{ "sources": { "tmdb": { "page": 1, "results": [{ "id": 1877, "name": "Phineas and Ferb" }] } } }
```

A title's candidates by name, for a client holding a release name and no id. `type` is
`movie` or `show`; `year` (optional) narrows a movie by its release year and a show by its
first air year. `sources.tmdb` is TMDB's `/search/movie` or `/search/tv` answer for the same
query; a provider may add other sources' searches. A client then reads a candidate through
`/api/metadata/tmdb:{movie|tv}:N`.

## Authentication and errors

A provider that takes a key reads it from the `x-api-key` header. Errors answer
`{"error": "..."}`:

| Status | Meaning                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------- |
| 400    | A malformed id or parameter                                                                         |
| 401    | Missing, unknown or revoked key                                                                     |
| 404    | No source knows the title (for an `imdb:` id with `sources=tmdb`: TMDB's find knows nothing for it) |
| 429    | The key's rate limit is spent; `Retry-After` gives the seconds                                      |
| 503    | A source the answer needs is rate-limiting the provider; `Retry-After`                              |

A client should treat anything but 200 and 404 as "no answer now" and fall back to whatever
it reads otherwise; rex asks TMDB itself.

## Building a provider

The smallest provider is a TMDB cache: answer `/api/metadata/<id>` from TMDB's `/find`,
`/movie/{id}` or `/tv/{id}` and the season and episode routes, and `/api/metadata/search`
from TMDB's search, keeping each answer a while. A season of an airing show gains an
episode a week; a finished title barely changes. Cache on the provider's side: a client
asks for the same seasons again on every start, and TMDB's limits fall on the provider.

DMM's implementation is `src/pages/api/metadata/[id].ts`, `src/pages/api/metadata/search.ts`
and `getMetadataBundle` in `src/services/metadata/index.ts`.

## DMM's provider

`https://debridmediamanager.com`, for sponsors: send the 64-character DMM API key from
[gatekeeper](https://gatekeeper.debridmediamanager.com) as `x-api-key`. It stops
working the moment the sponsorship lapses (401 `Sponsorship is no longer active`).

- **Limit:** 300 calls a minute per sponsorship, `/api/metadata/<id>` and `/search` together,
  counted across every machine using the key.
- **Sources:** `tmdb`, `tmdbFind`, `trakt`, `traktSeasons`, `traktNext`, `traktLast`,
  `mdblist`, `cinemeta`, `omdb` and `tvmaze`, plus `tmdbSeason` and `tmdbEpisode` when asked.
  An episode's IMDb id answers `omdb` and `tmdbFind` only.
- **`merged`:** DMM's canonical record, merged from all of them: title and aliases, the
  original release year, ids, ratings, and for a show its seasons with episode counts.
  A title IMDb does not know (an anime season TMDB files as a show of its own) has `null`.
- Answers come from DMM's cache, so most are already there when you ask.

The endpoints are also listed with DMM's other sponsor APIs on
[/api-docs](https://debridmediamanager.com/api-docs).
