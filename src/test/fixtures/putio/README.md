put.io answers used by `src/services/putio.test.ts` and `src/utils/putioRow.test.ts`.

Two kinds live here, and they are not equally trustworthy.

**Recorded** - `recorded-2026-11-15.json`. Real answers taken on 2026-11-15 from one put.io
account that had no plan, each kept as `{status, body}`. The mail, avatar, user id, username,
`family_owner` and `token_id` are replaced with placeholders; no token is stored. What they show:

- An account without a plan signs in: `account/info` answers 200 with
  `account_status: "stranger"` and `disk: {avail: 0, size: 0, used: 0}`.
- On that account `transfers/add` and `files/{id}/url` answer 402 `PaymentRequired`, even
  for a malformed URL or an unknown file, before anything else is checked.
- `transfers/info` is non-mutating and answers 200 there too. An unknown hash comes back
  with `file_size: 0` and `human_size: "unknown"`.
- A bad token answers 401 `Unauthorized`; an unknown transfer id answers 404 `NotFound`.
- An empty account lists `{"status":"OK","transfers":[]}` and a root with `files: []` and
  `parent` id 0.

**Schema-derived** - `transfers.json`, `files.json`, `account.json`, `oauth.json`. Built by
hand from put.io's published TypeScript client schemas (`TransferSchema`,
`FilesListEnvelopeSchema`, `AccountInfoBaseSchema`) and its API docs, **not captured from a
live account**. No paid account existed when they were written, so nothing about a real
transfer, a real folder listing or a real download URL has been seen. `transfers.json`
holds one transfer for every status in the SDK's `TransferStatusSchema` plus three shapes the
row conversion must tolerate (hash only in the magnet `source`, a URL transfer with no hash,
null size/progress/speed). `oauth.json` follows the device-link shapes as measured on
2026-11-15, with a placeholder token.

Replace each schema-derived file with recorded captures as soon as a paid account can make
them, and move what the captures show into the list above. The tests read only these files,
so swapping one is the whole change.
