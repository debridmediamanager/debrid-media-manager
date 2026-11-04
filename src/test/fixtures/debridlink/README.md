Recorded Debrid-Link `GET /api/v2/seedbox/list` answers from one premium account.
`src/services/debridLink.recorded.test.ts` builds its model of the seedbox from them
and checks the model against them before using it.

`seedbox-list-2026-09-06.json` is four consecutive `?page=N&perPage=100` answers from
2026-09-06, when the account held 306 torrents. They are the same captures the DL
Jellyfin plugin's tests use, with torrent ids already replaced consistently (the
download URLs carry the replacements) and tracker URLs removed. Everything else is as
recorded. What the model takes from them:

- The pagination object runs from `{page: 0, pages: 4, next: 1, previous: -1}` to
  `{page: 3, pages: 4, next: -1, previous: 2}` over 100, 100, 100 and 6 rows.
- The order is newest `created` first across all four pages.

`seedbox-list-ids-filter-2026-10-03.json` holds seven read-only `?page=0&perPage=100&ids=`
reads taken on 2026-10-03 while the account held the seven torrents listed under
`account`. Each keeps the requested ids in order, the pagination object verbatim and
the returned ids in order. Real ids are replaced (the five torrents that also appear in
the plugin's captures get the replacement those captures use), and names, files and
URLs are dropped. One requested id was the real id of a torrent the account removed in
September (replaced here like the rest). The 97 well-formed ids in the 100-id read were
generated for it and never existed. What they show:

- A filter holds when the ids are well-formed, held or not. A removed torrent's id, a
  generated id, or both together answer an empty page with `next: -1`.
- A malformed id (`notarealid`) drops the filter and answers the whole account.
- Held ids come back in the order they were asked for, not in list order.
- 100 ids in one read are accepted.

Earlier observations the model also follows, from the same account: on 2026-09-12
a re-add after removal came back with its old id and a fresh `created`, and a page past
the end answered `{page: 5, pages: 1, next: -1, previous: 4}`. On 2026-09-17 a duplicate
add of a torrent the account held moved it to the top with a fresh `created` (the
2026-10-03 listing shows the 2026-09-17 time).

`seedbox-add-verity-2026-11-04.json` is the bare-hash `POST /seedbox/add` answer for each
of DMM's 25 largest Verity (tt32261958) releases, taken on 2026-11-04 in one pass with the
account that now probes for DMM Cast DL. `candidates` are the releases as DMM's scraped
pool held them; `adds` keeps each status and body as answered, with every `downloadUrl`
replaced (those URLs are keyless and permanent). The listing taken before the pass is kept
as its envelope only (`emptyListing`, verbatim pagination) because the rows were the
account's own unrelated torrents. What it shows:

- 13 cached, 12 `422 notAddTorrent`: a miss now answers 422 (it was 400 until October).
- One add is admitted but incomplete: `status: 4`, `downloadPercent: 27`. Admission is not
  "cached".
- The 13 created torrents came back from one comma-joined `DELETE /seedbox/<ids>/remove`.
