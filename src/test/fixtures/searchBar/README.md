# Quick-search fixtures

Production's answers to the two requests the home page's search dropdown makes,
captured from `https://debridmediamanager.com` on 2026-09-27 at 13:38 UTC. Nothing here
is hand-written; the bodies are as received, only reformatted.

| File                             | Source                                              | Why it is here                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-trakt-search-frieren.json`  | `/api/trakt/search?query=frieren&types=movie,show`  | 25 rows; the show _Frieren: Beyond Journey's End_ (`tt22248376`) first, then films about peace (_Frieden_). What the dropdown listed before anime was added.        |
| `api-search-anime-frieren.json`  | `/api/search/anime?keyword=frieren`                 | Six rows: the three TV seasons as AniDB ids (17617, 18886, 19977), then three `anime:mal-*` shorts and specials. The dropdown keeps the first three.                |
| `api-trakt-search-bookworm.json` | `/api/trakt/search?query=bookworm&types=movie,show` | Four rows, _Ascendance of a Bookworm_ first. Trakt has one show for what AniDB splits into five entries.                                                            |
| `api-search-anime-bookworm.json` | `/api/search/anime?keyword=bookworm`                | Thirteen rows with `type`; the second is `anime:mal-1278`, a Special with no AniDB id, whose page is `/anime/mal-1278`.                                             |
| `api-trakt-search-dou-po.json`   | `/api/trakt/search?query=dou%20po&types=movie,show` | Ten rows, the donghua under its English titles (_Fights Break Sphere_, _Battle Through the Heaven_), each routed by an IMDb id.                                     |
| `api-search-anime-dou-po.json`   | `/api/search/anime?keyword=dou%20po`                | AniDB 17052, _Dou Po Cangqiong Nian Fan_, has no IMDb id (`/api/info/anime` answers `imdbid: ""`). Two rows arrive as `anime:mal-null`, which have no page to link. |
