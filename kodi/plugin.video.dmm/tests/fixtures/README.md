# Test fixtures

Recorded answers that drive `test_dmm.py` and `test_trackers.py`. The `cinemeta-*`, `dmm-*`, `en-*`, `pm-*`,
`rd-*` and `tb-*` files are captures from the live services (dated in the tests that use them).
`cinemeta-meta-theoffice-s1-2.json` and `cinemeta-meta-bluey-s3.json` were captured on 2026-11-09 and keep only
those seasons' `videos`; Cinemeta dates every episode of The Office 2001-01-31.

## Trakt and Simkl

Live captures of 2026-11-09 by `record_trackers.py`, truncated to 3 rows per list (per page on Trakt), with
nothing else removed. They are named `<service>-<name>.json` after the request in `trackers.PATHS`; Trakt's second
page of films is `trakt-movies-2.json`, and `trakt-pages.json` holds each Trakt page's `x-pagination-*` headers.
Trakt was recorded 100 to a page (the addon asks for 250), so its 165 films span two pages.

| File                  | Request                                                                                   | Rows recorded | Kept |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------- | ---- |
| `trakt-activity.json` | `GET /sync/last_activities`                                                               |               |      |
| `trakt-movies.json`   | `GET /sync/watched/movies?page=1&limit=100`                                               | 100 of 165    | 3    |
| `trakt-movies-2.json` | `GET /sync/watched/movies?page=2&limit=100`                                               | 65 of 165     | 3    |
| `trakt-shows.json`    | `GET /sync/watched/shows?extended=progress&page=1&limit=100`                              | 52            | 3    |
| `simkl-activity.json` | `GET /sync/activities`                                                                    |               |      |
| `simkl-movies.json`   | `GET /sync/all-items/movies/completed`                                                    | 147           | 3    |
| `simkl-shows.json`    | `GET /sync/all-items/shows?extended=full&include_all_episodes=yes&episode_watched_at=yes` | 37            | 3    |

Rows without `ids.imdb`: none of Trakt's 165 films or 52 shows, one of Simkl's 147 films ("Episode 1", kept so the
tests cover it) and none of its 37 shows.

The rows kept are what the tests need: films on both trackers, on one alone and without an IMDb id; the two shows
on both with the most seasons watched (Bluey, with a special on Trakt, and The Office), then one watched to the end
(Queen of Tears on Trakt, Heimsendir on Simkl). Both accounts hold the same person's history.

Docs: <https://trakt.docs.apiary.io/> (Sync → Last Activities, Get Watched) and Trakt's paging and `extended`
change of 2026-06-30, <https://github.com/trakt/trakt-api/discussions/775>;
<https://api.simkl.org/api-reference/simkl/get-activities>, <https://api.simkl.org/api-reference/simkl/get-all-items>.

To record again, with a test account's tokens (the repository is public, and the answers are that account's
history; the recorder writes no token):

```sh
TRAKT_ACCESS_TOKEN=... TRAKT_CLIENT_ID=... SIMKL_ACCESS_TOKEN=... SIMKL_CLIENT_ID=... \
    python3 kodi/plugin.video.dmm/tests/record_trackers.py
```

It retries Trakt's 429s after 45 s and prints how many rows came without `ids.imdb`. Then update this file and the
expectations in `test_trackers.py`.
