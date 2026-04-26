# DMM Cast Endpoints (Real-Debrid Addon)

Base URL: `https://debridmediamanager.com`

`{userid}` is a 12-character HMAC-SHA256 of the Real-Debrid username, salted with `DMMCAST_SALT` (see `src/utils/castApiHelpers.ts`). It is a stable, opaque identifier — not the RD token — and is safe to embed in the addon install URL.

---

## Cast (unrestrict + save)

These endpoints are called by the DMM web UI. They unrestrict the selected link via Real-Debrid and persist the result to the cast DB so Stremio can later stream it.

| Method | Path                                                                                                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/stremio/cast/{imdbid}?token={rdToken}&hash={hash}&fileId={fileId}&mediaType={movie\|tv\|anime}` | Generic per-file cast. Unrestricts one selected file and saves it keyed by imdbid (+ season/episode if detected). Returns an HTML redirect to `stremio://detail/...`. Source: `src/pages/api/stremio/cast/[imdbid].ts`.                                                                                                                                                                                                                     |
| `GET`  | `/api/stremio/cast/movie/{imdbid}?token={rdToken}&hash={hash}`                                        | Movie cast. Picks the biggest file in the torrent, unrestricts, saves. Returns JSON `{status, message, filename}`. Source: `src/pages/api/stremio/cast/movie/[imdbid].ts`.                                                                                                                                                                                                                                                                  |
| `GET`  | `/api/stremio/cast/series/{imdbid}?token={rdToken}&hash={hash}&fileIds={id}&fileIds={id}...`          | Series cast. Iterates a list of fileIds, unrestricts each episode, saves per-episode keys. Returns `{errorEpisodes}`. Source: `src/pages/api/stremio/cast/series/[imdbid].ts`.                                                                                                                                                                                                                                                              |
| `GET`  | `/api/stremio/cast/anime/{anidbid}?token={rdToken}&hash={hash}&fileIds={id}&fileIds={id}...`          | Anime cast. Same as series, keyed by anidbid. Source: `src/pages/api/stremio/cast/anime/[anidbid].ts`.                                                                                                                                                                                                                                                                                                                                      |
| `GET`  | `/api/stremio/cast/library/{torrentId}:{hash}?rdToken={rdToken}&imdbId={tt1234567}`                   | RD library cast. Pulls the existing RD torrent via `getTorrentInfo`, maps selected files to links, parses season/episode from filenames, saves each. If the hash has no known IMDB mapping, returns `{status: "need_imdb_id", torrentInfo}` prompting the caller to supply `imdbId`. On success returns `{status, redirectUrl, imdbId, mediaType, season?, episode?}`. Source: `src/pages/api/stremio/cast/library/[torrentIdPlusHash].ts`. |

**Auth:** the four non-library endpoints accept the RD token via `Authorization: Bearer {token}`, `?token=`, or `body.token` (`extractToken`). The `library` endpoint only reads `rdToken` from the query string.

## Cast profile management

These create/update the server-side RD cast profile tied to `{userid}`. The profile stores the RD OAuth credentials that the Stremio-facing endpoints use on the caster's behalf.

| Method | Path                                 | Purpose                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/stremio/cast/saveProfile`      | Creates/upserts the profile from `{clientId, clientSecret, refreshToken?, movieMaxSize?, episodeMaxSize?, otherStreamsLimit?, hideCastOption?}`. Exchanges the credentials via `getToken` to derive the `userid`. Source: `src/pages/api/stremio/cast/saveProfile.ts`. |
| `POST` | `/api/stremio/cast/updateSizeLimits` | Same body shape as `saveProfile`; additionally requires at least one size/limit/hide field present. Effectively a near-duplicate of `saveProfile`. Source: `src/pages/api/stremio/cast/updateSizeLimits.ts`.                                                           |

## Cast link helpers (UI side)

Used by the DMM web UI to look up and manage the caller's own cast entries. All require the RD token (Bearer header, `?token=`, or `body.token`) and derive `userid` server-side via `generateUserId`.

| Method | Path                      | Purpose                                                                                                                                                |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/stremio/id`         | Returns `{id}` — the `userid` derived from the provided RD token. Lets the UI show/build the addon install URL. Source: `src/pages/api/stremio/id.ts`. |
| `GET`  | `/api/stremio/links`      | Returns every cast entry (link + metadata) belonging to this user. Source: `src/pages/api/stremio/links.ts`.                                           |
| `POST` | `/api/stremio/deletelink` | Deletes a single cast entry. Body: `{imdbId, hash}`. Source: `src/pages/api/stremio/deletelink.ts`.                                                    |

---

## Stremio addon endpoints (consumed by Stremio clients)

These are the URLs under the `/api/stremio/{userid}/...` prefix that Stremio hits once the addon is installed. All check for legacy 5-character `userid`s and respond with an "Update Required" meta/stream if detected.

### Manifests

| Method | Path                                             | Purpose                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/stremio/{userid}/manifest.json`            | Default manifest. Advertises `stream` (movie, series), `meta` (other) and three catalogs: `casted-movies`, `casted-shows`, `casted-other` (the DMM library browser). Source: `src/pages/api/stremio/[userid]/manifest.json.ts`.            |
| `GET`  | `/api/stremio/{userid}/no-catalog/manifest.json` | Slim manifest without the `other` library catalog/meta — only the two casted catalogs. Used by users who don't want their RD library exposed as a browsable catalog. Source: `src/pages/api/stremio/[userid]/no-catalog/manifest.json.ts`. |

### Catalogs

| Method | Path                                                           | Purpose                                                                                                                                                                               |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/stremio/{userid}/catalog/movie/casted-movies.json`       | Returns the list of imdbids the user has cast as movies. Poster from metahub. Source: `src/pages/api/stremio/[userid]/catalog/movie/casted-movies.json.ts`.                           |
| `GET`  | `/api/stremio/{userid}/catalog/series/casted-shows.json`       | Returns the list of imdbids the user has cast as series. Source: `src/pages/api/stremio/[userid]/catalog/series/casted-shows.json.ts`.                                                |
| `GET`  | `/api/stremio/{userid}/catalog/other/casted-other.json`        | Page 1 of the user's RD library rendered as a Stremio `other` catalog. Source: `src/pages/api/stremio/[userid]/catalog/other/casted-other.json.ts`.                                   |
| `GET`  | `/api/stremio/{userid}/catalog/other/casted-other/{skip}.json` | Paginated RD library. `{skip}` is Stremio's offset; converted to `page = floor(skip / PAGE_SIZE) + 1`. Source: `src/pages/api/stremio/[userid]/catalog/other/casted-other/[skip].ts`. |

### Meta

| Method | Path                                         | Purpose                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/stremio/{userid}/meta/other/{id}.json` | Meta page for a single RD torrent (`id` prefixed with `dmm:`). Fetches the torrent via `getDMMTorrent` using the user's cast profile credentials. AllDebrid/TorBox IDs (`dmm-ad:`/`dmm-tb:`) return `{meta: null}` so other addons handle them. Source: `src/pages/api/stremio/[userid]/meta/other/[id].ts`. |

### Stream

| Method | Path                                                     | Purpose                                                                                                                                                                                                                                                                                                                                                           |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/stremio/{userid}/stream/{mediaType}/{imdbid}.json` | Lists stream options for a title: the "DMM Cast RD✨" external-URL entry (unless `hideCastOption`), up to 5 of the user's own casts, and up to 5 "other" community streams filtered by `movieMaxSize`/`episodeMaxSize`. URLs point to `/api/stremio/{userid}/play/{link}`. Rate-limited. Source: `src/pages/api/stremio/[userid]/stream/[mediaType]/[imdbid].ts`. |

### Playback

| Method | Path                                                            | Purpose                                                                                                                                                                                                                                                                                             |
| ------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/stremio/{userid}/play/{link}`                             | Resolves a stored RD link on-demand: loads the user's cast profile, refreshes the RD token, calls `unrestrictLink`, then `302`s to the actual RD download. On failure, removes the availability record for that hash. Source: `src/pages/api/stremio/[userid]/play/[link].ts`.                      |
| `GET`  | `/api/stremio/{userid}/watch/{imdbid}/{pingpong}?token={token}` | Long-poll helper. If a cast already exists for this imdbid+userid, 302s to `/play/...`; otherwise waits 3s and bounces between `ping` and `pong`. Used by the "Watch on Stremio" flow to wait for an async cast to complete. Source: `src/pages/api/stremio/[userid]/watch/[imdbid]/[pingpong].ts`. |

---

## Notes

- **Token handling:** `extractToken` (`src/utils/castApiHelpers.ts`) accepts `Authorization: Bearer`, `?token=`, or `body.token`, in that order. The library cast endpoint is the only one that bypasses it.
- **Legacy token migration:** any `userid` with length 5 is treated as legacy and every catalog/meta/stream endpoint returns a single "Update Required" item pointing at `https://debridmediamanager.com/stremio`. New tokens are 12 chars.
- **User isolation:** the `userid` in the path scopes every DB read (`db.fetchCastedMovies`, `db.getUserCastStreams`, `db.getCastProfile`, etc.), so two users with different RD accounts never see each other's casts.
