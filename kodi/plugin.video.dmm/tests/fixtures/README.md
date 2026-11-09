# Test fixtures

Recorded answers that drive `test_dmm.py` and `test_trackers.py`. The `cinemeta-*`, `dmm-*`, `en-*`, `pm-*`,
`rd-*` and `tb-*` files are captures from the live services (dated in the tests that use them).

## Trakt and Simkl

From the docs, to be replaced with a `record_trackers.py` capture. Each is built from the example answer in the
tracker's API reference (2026-11-09), with titles and episodes chosen for the tests. They are named
`<service>-<name>.json` after the request in `trackers.PATHS`.

| File                  | Request                                                                                   | Source                                               |
| --------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `trakt-activity.json` | `GET /sync/last_activities`                                                               | from docs, replace with `record_trackers.py` capture |
| `trakt-movies.json`   | `GET /sync/watched/movies`                                                                | from docs, replace with `record_trackers.py` capture |
| `trakt-shows.json`    | `GET /sync/watched/shows?extended=full`                                                   | from docs, replace with `record_trackers.py` capture |
| `simkl-activity.json` | `GET /sync/activities`                                                                    | from docs, replace with `record_trackers.py` capture |
| `simkl-movies.json`   | `GET /sync/all-items/movies/completed`                                                    | from docs, replace with `record_trackers.py` capture |
| `simkl-shows.json`    | `GET /sync/all-items/shows?extended=full&include_all_episodes=yes&episode_watched_at=yes` | from docs, replace with `record_trackers.py` capture |

Docs: <https://trakt.docs.apiary.io/> (Sync → Last Activities, Get Watched),
<https://api.simkl.org/api-reference/simkl/get-activities>, <https://api.simkl.org/api-reference/simkl/get-all-items>.

To record, with a test account's tokens (the repository is public, and the answers are that account's history):

```sh
TRAKT_ACCESS_TOKEN=... SIMKL_ACCESS_TOKEN=... SIMKL_CLIENT_ID=... \
    python3 kodi/plugin.video.dmm/tests/record_trackers.py
```

It prints how many rows came without `ids.imdb`. Then update this table and the expectations in `test_trackers.py`.
