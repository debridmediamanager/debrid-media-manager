# Metadata fixtures

Verbatim provider responses, captured 2026-09-11, that the metadata freshness and
`/api/info/*` tests are driven from. Nothing here is hand-written: each file is the
body of one real request.

| File                                                      | Request                                                   | Why it is here                                                                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mdblist-tt37752275-*.json`                               | `https://mdblist.com/api?i=tt37752275`                    | Released 8 days before capture, IMDb 4.6 — while production was serving a cached 8.8 from the movie's first week. The case the short TTL exists for. |
| `cinemeta-tt37752275-*.json`                              | `https://v3-cinemeta.strem.io/meta/movie/tt37752275.json` | Same title, `imdbRating: "4.6"`.                                                                                                                     |
| `mdblist-tt32588798-*.json`                               | `https://mdblist.com/api?i=tt32588798`                    | Has the IMDb rating (62/100) that the other two sources lack.                                                                                        |
| `cinemeta-tt32588798-*.json`                              | `https://v3-cinemeta.strem.io/meta/movie/tt32588798.json` | Same title, `imdbRating: ""` — an empty string, not an absent field.                                                                                 |
| `omdb-tt32588798-*.json`                                  | `https://www.omdbapi.com/?i=tt32588798`                   | Same title, `imdbRating: "N/A"`. With the two above, the movie route used to answer 0.                                                               |
| `mdblist-tt0111161-*.json`, `cinemeta-tt0111161-*.json`   | 1994 movie                                                | A settled title, which must keep the long cache lifetime.                                                                                            |
| `mdblist-tt13443470-*.json`, `cinemeta-tt13443470-*.json` | Airing series                                             | `status: "Returning Series"` / `"Continuing"`, `year: "2022–"`, and a season whose `air_date` is still null.                                         |
| `mdblist-tt0903747-*.json`, `cinemeta-tt0903747-*.json`   | Series that ended in 2013                                 | Settled despite having seasons, so it must keep the long lifetime.                                                                                   |

API keys are query parameters and appear in no response body; these files carry none.
