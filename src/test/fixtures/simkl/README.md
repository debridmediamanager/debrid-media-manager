# Simkl AUTH V2 / Custom Lists fixtures

Checked-in inputs are either production captures, Simkl's published examples, or
captures from DMM's isolated session API on zen. Published examples establish
documented shapes, not successful live authentication or paid-list access.

| File                           | Provenance                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user-token-required-401.json` | Captured from production on 2026-09-21: `GET https://api.simkl.com/lists/76609` with DMM's V2 `client_id` and no `Authorization` header.                                           |
| `user-lists-200.json`          | `GET /lists/user/{userId}` 200 example, `openapi.json` (`examples.lists`).                                                                                                         |
| `list-items-200.json`          | `GET /lists/{id}` 200 example, `openapi.json` (`examples.list`).                                                                                                                   |
| `premium-only-200.json`        | `GET /lists/{id}` 200 example, `openapi.json` (`examples.premium_only`).                                                                                                           |
| `private-list-403.json`        | `GET /lists/{id}` 403 example, `openapi.json`.                                                                                                                                     |
| `user-settings-200.json`       | `GET /users/settings` 200 example, `openapi.json`.                                                                                                                                 |
| `token-200.json`               | `POST /oauth2/token` 200 example, `openapi.json`.                                                                                                                                  |
| `invalid-grant-400.json`       | `POST /oauth2/token` 400 example, `openapi.json`.                                                                                                                                  |
| `oauth-success-query.json`     | Successful redirect example from the AUTH V2 authorization-code guide, fetched 2026-10-02; includes `iss=https://simkl.com`.                                                       |
| `oauth-error-query.json`       | Denied redirect example from the same guide, fetched 2026-10-02; includes issuer and state.                                                                                        |
| `session-unavailable-503.json` | Actual isolated DMM `POST /api/simkl/logout` response on zen, 2026-10-02, while only this task's Redis container was stopped. The response also expired its opaque session cookie. |
| `signed-out-401.json`          | Actual isolated DMM `GET /api/simkl/account` response after that cookie was expired and the task's Redis container restarted, 2026-10-02.                                          |

`openapi.json` is Simkl's published spec, served at
<https://api.simkl.org/openapi.json> and fetched on 2026-09-21.
The redirect examples come from <https://api.simkl.org/api-reference/oauth2-authorization-code>.

Tests also derive explicit synthetic boundary variants from these inputs:
sparse pagination, nullable item year/poster, concurrent grant replacement, and
credential-like unknown error codes. These are not claimed as live provider
captures. Token examples are nonfunctional; no usable credentials are checked in.

Two of these encode traps rather than happy paths, and both are the reason the
client checks what it checks:

- **`user-token-required-401.json` is what a V2 `client_id` gets with no token.**
  AUTH V2 requires a user bearer token for API reads; public catalog CDN files
  are the exception. An anonymous Custom Lists request is therefore refused
  before it can be treated as a free account.
- **`premium-only-200.json` arrives with HTTP 200, not 403.** It carries no
  `items` array and no `pagination` object, and its `item` (singular) is a
  renderable placeholder with a real poster. A client that branches on the
  status code alone renders "Upgrade to Simkl PRO/VIP" as though it were a
  title in the user's list.
