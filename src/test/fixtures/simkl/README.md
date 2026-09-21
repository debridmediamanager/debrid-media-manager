# Simkl AUTH V2 / Custom Lists fixtures

Response bodies the Simkl client is driven from. None of these are hand-written:
each one is either a production capture or Simkl's own published example, so a
test that passes here is a test against a shape Simkl actually emits.

| File                           | Provenance                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `user-token-required-401.json` | Captured from production on 2026-09-21: `GET https://api.simkl.com/lists/76609` with DMM's V2 `client_id` and no `Authorization` header. |
| `user-lists-200.json`          | `GET /lists/user/{userId}` 200 example, `openapi.json` (`examples.lists`).                                                               |
| `list-items-200.json`          | `GET /lists/{id}` 200 example, `openapi.json` (`examples.list`).                                                                         |
| `premium-only-200.json`        | `GET /lists/{id}` 200 example, `openapi.json` (`examples.premium_only`).                                                                 |
| `private-list-403.json`        | `GET /lists/{id}` 403 example, `openapi.json`.                                                                                           |
| `user-settings-200.json`       | `GET /users/settings` 200 example, `openapi.json`.                                                                                       |
| `token-200.json`               | `POST /oauth2/token` 200 example, `openapi.json`.                                                                                        |
| `invalid-grant-400.json`       | `POST /oauth2/token` 400 example, `openapi.json`.                                                                                        |

`openapi.json` is Simkl's published spec, served at
<https://api.simkl.org/openapi.json> and fetched on 2026-09-21.

Two of these encode traps rather than happy paths, and both are the reason the
client checks what it checks:

- **`user-token-required-401.json` is what a V2 `client_id` gets with no token.**
  The Custom Lists guide describes an anonymous caller as "treated as a free
  account" and answered with the `premium_only` body below. That is V1
  behaviour. A V2 `client_id` is refused outright, on every endpoint including
  `/users/settings`, which is why the client never attempts an anonymous read.
- **`premium-only-200.json` arrives with HTTP 200, not 403.** It carries no
  `items` array and no `pagination` object, and its `item` (singular) is a
  renderable placeholder with a real poster. A client that branches on the
  status code alone renders "Upgrade to Simkl PRO/VIP" as though it were a
  title in the user's list.
