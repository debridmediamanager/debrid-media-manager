put.io answers used by the put.io tests (`src/services/putio.test.ts`, `src/utils/*putio*.test.ts`,
`src/components/showInfo/putio.test.ts`, the login page and service card tests).

Two kinds live here, and they are not equally trustworthy.

## Recorded

Real answers from one put.io account on 2026-11-15, each kept as `{status, body}`. Mail, avatar,
user id, username, `family_owner` and `token_id` are placeholders; transfer, file and download ids
are renumbered consistently across files; cursors, icon and screenshot URLs are placeholders; no
token is stored. The download URL in `file-url` is replaced whole, because put.io puts an
`oauth_token` and a signed `u=` parameter in it.

`recorded-2026-11-15.json`, while the account had no plan:

- It signs in: `account/info` answers 200 with `account_status: "stranger"` and
  `disk: {avail: 0, size: 0, used: 0}`.
- `transfers/add` and `files/{id}/url` answer 402 `PaymentRequired`, even for a malformed URL or an
  unknown file, before anything else is checked. `transfers/info` still answers 200, and an unknown
  hash comes back with `file_size: 0` and `human_size: "unknown"`.
- A bad token answers 401 `Unauthorized`; an unknown transfer id answers 404 `NotFound`.
- An empty account lists `{"status":"OK","transfers":[]}` and a root with `files: []`, parent id 0.

`recorded-paid-2026-11-15.json`, after a 100 GB plan was bought:

- `account/info`: `account_status: "active"`, `account_active: true`, disk in bytes
  (107374182400), no `plan_expiration_date` field, `warnings: {}`.
- `transfers/add` answers before put.io has read the magnet: `PREPARING_DOWNLOAD`, `hash`,
  `size` and `file_id` null, `type: "N/A"`, and the magnet itself as `name`
  (`transfers-add-known`). The same transfer was `IN_QUEUE` with hash and size a moment later
  (`transfer-in_queue`), then `COMPLETED`, named, with `file_id` (`transfer-completed`).
- put.io does not dedupe: the same magnet again made a second transfer (`transfers-add-duplicate`)
  and a second folder `Big Buck Bunny oxhCwH2H` (`files-list-root-dup`).
- An unknown hash is accepted and stays `DOWNLOADING` with size 0, no peers and no `file_id`,
  named after the hash (`transfers-add-unknown`, `transfer-unknown-after6s`). A non-magnet answers
  400 `UNSUPPORTED_URI_SCHEME` (`transfers-add-garbage`); in `add-multi` it comes back as one
  entry of `errors` beside the transfers that were made (`transfers-add-multi`).
- `transfers/list?per_page=2` pages newest first with `cursor` and `total`
  (`transfers-list-four`); `POST transfers/list/continue` follows it (`transfers-list-continue`).
  Without `per_page` there is no cursor (`transfers-list-one`, `transfers-list-two`).
- A transfer's `file_id` is its folder (`file-folder`); listing it gives the files
  (`files-list-folder`). A single-file torrent's `file_id` is the file itself
  (`transfer-single-file`, `file-single`), and listing a file's id answers `files: []` with
  the file as `parent` (`files-list-of-file`). Listing a deleted folder answers 404 NotFound
  (`files-list-deleted-folder`). `files/{id}/url` returns a download URL whose `oauth_token`
  is the account's long-lived download token; it served from another IP too.
- `files/delete` answers 200 and leaves the transfer `COMPLETED` with a dangling `file_id`
  (`transfer-after-file-delete`, `file-deleted-get` is the 404 for it). `transfers/cancel` answers
  200 and keeps files. Both answer 200 OK for ids that do not exist (`files-delete-again`,
  `transfers-cancel-unknown-id`), so a success proves nothing.
- Deleted files go to put.io's trash (`trash-list`) and still count against the storage.

## Schema-derived

`transfers.json`, `files.json`, `account.json` and `oauth.json` were built by hand from put.io's
published TypeScript client schemas and its API docs, not captured. They stay only for shapes no
capture shows: a transfer for every status in the SDK's `TransferStatusSchema` (only
`PREPARING_DOWNLOAD`, `IN_QUEUE`, `DOWNLOADING` and `COMPLETED` were seen), a URL transfer with no
hash, a transfer with every field null, and a folder inside a folder. `oauth.json` follows the device-link shapes measured on
2026-11-15, with a placeholder token.

Replace each with a capture when one exists, move what it shows into the lists above, and point the
tests at it. The tests read only these files, so swapping one is the whole change.
