Tracker answers behind `/api/kodi/tracker/*`, read by `src/test/api/kodi/tracker.test.ts`.
Each file is `{status, body}`: the HTTP status and the body as received (`""` for an empty
body). Replace a file with a live capture of the same call and the tests run on it as is.

## Recorded live

Recorded on 2026-11-09 with curl and the headers DMM sends: for Trakt DMM's own app
credentials, `trakt-api-version: 2`, `trakt-api-key` and `User-Agent: debridmediamanager/1.0`;
for Simkl DMM's public AUTH V2 client id (no secret exists) as the `client_id` query and form
parameter, with `app-name=debridmediamanager&app-version=1.0` and the same User-Agent. The
approved polls, the Trakt refresh and both profiles come from live approvals of DMM's apps
the same day, with tokens redacted. No secret is in any file. The device and user codes are
dead: Trakt's after 600 s, Simkl's after 900 s.

| File                                    | Call                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `trakt-device-code.json`                | `POST https://api.trakt.tv/oauth/device/code` with `{client_id}`                                                                                                               |
| `trakt-device-token-pending.json`       | `POST /oauth/device/token` for that code, the first poll, before anyone approved                                                                                               |
| `trakt-device-token-slow-down.json`     | The same poll sent again at once                                                                                                                                               |
| `trakt-device-token-unknown.json`       | The same poll for a made-up 43-character code                                                                                                                                  |
| `trakt-device-token-expired.json`       | The same poll for the first code, after its 600 s ran out                                                                                                                      |
| `trakt-device-code-invalid-client.json` | `POST /oauth/device/code` with a made-up client id                                                                                                                             |
| `trakt-refresh-invalid-grant.json`      | `POST /oauth/token` with `grant_type: refresh_token` and a made-up refresh token                                                                                               |
| `trakt-device-token-approved.json`      | The device-code poll after a live approval of DMM's app; tokens redacted                                                                                                       |
| `trakt-refresh-ok.json`                 | `POST /oauth/token` with that grant's refresh token, the same day; tokens redacted. It carries `expires_at` beside `expires_in`                                                |
| `trakt-users-settings.json`             | `GET /users/settings` with the approved access token, cut to `user`, `account`, `connections` and `limits` (a public profile)                                                  |
| `simkl-device.json`                     | `POST https://api.simkl.com/oauth2/device` with `client_id` and `scope=media:read`; no PKCE fields were needed                                                                 |
| `simkl-token-pending.json`              | `POST /oauth2/token` (device-code grant) for that code, the first poll, before anyone approved                                                                                 |
| `simkl-token-slow-down.json`            | The same poll sent again at once                                                                                                                                               |
| `simkl-token-expired.json`              | The same poll for a made-up code: Simkl answers an unknown code and an expired one alike                                                                                       |
| `simkl-refresh-invalid-grant.json`      | `POST /oauth2/token` with `grant_type=refresh_token` and a made-up refresh token                                                                                               |
| `simkl-refresh-ok.json`                 | `POST /oauth2/token` with `grant_type=refresh_token` and the real refresh token, recorded 2026-11-09 (tokens redacted); Simkl returned the same refresh token, as its docs say |
| `simkl-invalid-client.json`             | `POST /oauth2/token` (device-code grant) with a made-up client id; `/oauth2/device` answered the same body                                                                     |
| `simkl-token-approved.json`             | The device-code poll after a live approval of DMM's app: keys and `expires_in`/`scope`/`token_type` as recorded, tokens replaced                                               |
| `simkl-users-settings.json`             | `GET /users/settings` with that access token, cut to the fields DMM reads (`user.name`, `account.id`) and `account.type`                                                       |

Trakt answered the poll with a wrong `client_secret` as `400` pending too: it does not check
the secret before someone approves the code. After the refresh, the old Trakt access token
still answered `200` on `/users/settings`: Trakt does not revoke it at once.
