# Anime fixtures

Real inputs, captured 2026-09-27, that the `/api/*/anime` and anime mapping tests are
driven from. Nothing here is hand-written. Upstream bodies were requested from dmm-01,
production's egress, because the community Stremio addon answers that address
differently from a residential one.

| File                                         | Source                                                                              | Why it is here                                                                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-anime-frieren.json`                  | `https://debridmediamanager.com/api/search/anime?keyword=frieren`                   | The ids search hands out: `anime:anidb-17617` and three `anime:mal-*`. `/api/info/anime` accepted only Kitsu ids, so every one of them rendered as the "Unknown" placeholder with a random picsum image. |
| `anime-rows-search-frieren.json`             | `Anime` rows behind those four ids, selected as `getAnimeByExternalId` selects them | Each carries the `kitsu_id` that translates a search id into the id space both metadata upstreams use. Frieren's `imdb_id` is still null here; the Fribb sync had never been applied.                    |
| `kitsu-anime-{46474,48105,48113,48642}.json` | `https://kitsu.io/api/edge/anime/{id}`                                              | Kitsu's answer for each of those rows. The addon returns 403 to dmm-01, so this is the source production renders from.                                                                                   |
