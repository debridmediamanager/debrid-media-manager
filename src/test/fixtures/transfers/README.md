`jobs-mine-listings.json` holds what the two transfer services' `GET /jobs/mine`
listings returned for two production accounts on 2026-10-03, in each service's
own order. They were read straight from the services' databases with the
listing queries verbatim (`listJobsForOwner` in nzb2rd, `listJobsForRdOwner` in
the debrid uploader on debrid02), because the endpoint itself answers only to
the account's own key.

- `heavyUsenet`: the account with the most nzb2rd jobs, 648, the only one past
  the services' 500-row page cap. 566 of them were still pending. It had no
  debrid jobs.
- `mixed`: the account with the most jobs spread over both services, 41 debrid
  and 36 nzb2rd, interleaved in time.

Only `status` and `created_at` are kept. Ids are replaced by position, and each
account's timestamps are shifted by one constant so its newest row reads
`2026-09-01 12:00:00`. The order, the gaps and the same-second ties (six pairs
in `heavyUsenet`) are as recorded.

The same day nzb2rd's offset pages were checked against one full listing for
its 15 largest accounts, 2420 `limit`/`offset` pairs, with no difference. A
page boundary inside a same-second tie lands on the same row every time.

`completed-unfiled-2026-10-03.json` holds what DMM and its two transfer services
said on 2026-10-03 about eleven jobs, chosen to cover what filing a completed
transfer has to decide. `nzb2rd.listing` and `debrid.listing` are rows of each
service's `GET /jobs`, `nzb2rd.jobs` the same jobs' `GET /jobs/:id` (which adds
`files`), and `debrid.files` debrid02's `GET /jobs/:id/files`. `dmm` is what the
database held for them, read with a read-only session: which info hashes
`Available` had, the `xfer:` page context, the `nzbrd:` markers and the IMDb
title types.

- `nzb2rd-A1`, `nzb2rd-A2`: DMM submissions (a film and a show season) whose
  marker still read `pending` hours after the job completed. Not in search.
- `nzb2rd-B1`: an episode nobody submitted through DMM, so no page context and
  no marker. Not in search; IMDb calls the title a series.
- `nzb2rd-F`: a completed DMM submission that was filed.
- `nzb2rd-E`: completed, a DVD image of five VOB files, which no filing accepts.
  Its release's marker belongs to an earlier completed job of the same release.
- `nzb2rd-G`: completed and not in search, a week before the others.
- `nzb2rd-H`: failed. `nzb2rd-I`: completed with no IMDb id.
- `debrid-D1`, `debrid-D2`: TB → RD jobs DMM submitted without a page, with no
  `tbrd:` mapping left pointing at them. Not in search. `debrid-DF`: failed.

At the time 2862 of 7656 completed nzb2rd jobs with an IMDb id and 95 of 932
debrid02 jobs had never reached `Available`.

Job ids are replaced by the labels above, indexer release ids by `ix:release-N`,
and each RD download link by a `FIXTURE` placeholder of the same shape. Account
fields (`owner_hash`, `rd_user_id`), internal URLs and paths are dropped. Names,
sizes, hashes, statuses and timestamps are as recorded.

`lost-filings-2026-10-04.json` holds two library pages that lost filed releases
to concurrent saves, read on 2026-10-04 with a read-only session. Each page is
the `ScrapedTrue` row as it stood (`page`), and `filings` are the completed
nzb2rd jobs of that season that reached `Available`, in the order filing wrote
their `Available` rows (`filedAt` is that row's `updatedAt`, `availableBytes`
its `bytes`, `completedAt` the job's own completion time). `inPage` says whether
the page still held the release.

- `tv:tt0837069:1`, Viva Pinata season 1: 25 episodes completed over nine hours
  on 2026-09-06 and were all filed within five seconds of 06:27:26 on
  2026-09-07, when a Transfers page listing them was opened. The page holds 4.
- `tv:tt0074049:1`, Rock Follies season 1: three episodes filed within 90 ms on
  2026-10-02. The page holds 2.

That day 1,167 of 4,835 filed nzb2rd releases and 31 of 838 debrid02 ones were
in `Available` and on no page of their title. 1,096 of those 1,198 had a sibling
of the same title filed within two seconds, against 579 of the 4,475 that
survived. Hashes, titles, sizes and timestamps are as recorded.

`half-filed-2026-10-06.json` holds three completed jobs whose names run past
191 characters, as their services served them on 2026-10-06: nzb2rd's
`GET /jobs/:id` for `nzb2rd-judas` (218 characters), and debrid02's `GET /jobs`
row and `GET /jobs/:id/files` for `debrid-gsh` (249) and `debrid-tanya` (199).
Filing cut the title to 255 characters and left the raw name whole, but
`Available.filename` and `.originalFilename` are varchar(191), so each one's page
entry was written and its `Available` insert then failed. `dmm.pages` is that
entry as its `ScrapedTrue` page held it, read with a read-only session; none of
the three had an `Available` row or a filing record. `dmm.transferMeta` is each
job's `xfer:` record and `dmm.imdbTitleTypes` the titles' IMDb types.

That day none of the 11 completed jobs across both services with a name past 191
characters was in `Available`; 7 sat on their page and 4 had no page to be filed
under. debrid02's `debrid-gsh` was inside the cron sweep's window and failed
every tick from 01:35 UTC, 223 of them by 20:10, rewriting its page each time.

Job ids are replaced by the labels above, the indexer release id by
`ix:release-1`, and each RD download link by a `FIXTURE` placeholder of the same
shape. Account fields, internal URLs and paths are dropped. Names, sizes,
hashes, statuses and timestamps are as recorded.

`failed-marker-polls-2026-10-07.json` holds three `nzbrd:` markers that one poll
of a production Transfers page rewrote together on 2026-10-07, read with a
read-only session: they share the poll's `updatedAt`, and that account's polls
rewrote about twenty failed markers every five seconds. `printed` is the block
dmm_web logged each time one of those rewrites dropped the release's waiter list
and found none to drop. That day 3 releases had a waiter list against 852
`failed` markers, and the block was about half of every line dmm_web logged.

Release ids are replaced by `ix:release-N` and job ids by `nzb2rd-PN`. Titles,
IMDb ids, nzb2rd's error text and the timestamp are as recorded.

`waiter-markers-2026-10-07.json` holds five `nzbrd:` markers that still read
`pending` on 2026-10-07, what nzb2rd's `GET /jobs/:id` answered for each one's
job that day, and the three `nzbwait:` waiter lists then stored, which were all
there were. Everything was read with a read-only session.

- `nzb2rd-W1`, `nzb2rd-W2`: deleted on 2026-09-22 while `hashing`, so nzb2rd
  serves them as `hashing` with `deleted: 1` for good and never resumes them.
  Each had one account waiting since 09-22, with an access token and no OAuth
  credentials.
- `nzb2rd-W3`: really queued since 2026-09-17, 24th of 1188 in line. One account
  waiting since 09-24, with OAuth credentials.
- `nzb2rd-D1`: deleted on 2026-09-22 while still `pending`.
- `nzb2rd-C1`: completed on 2026-08-28 and deleted on 08-30, its marker still
  `pending`.

That day 942 markers read `pending`: 469 behind failed jobs, 14 behind completed
ones, 9 behind deleted ones (8 deleted before finishing), and 450 behind jobs
still in line or running. nzb2rd's queue was 23 days deep.

Job ids are replaced by the labels above, release ids by `ix:release-N`, and
each stored credential by a `FIXTURE` placeholder of the same length. Account
fields, internal URLs and paths, the RD torrent id and C1's 24 files are dropped.
Names, statuses, timestamps, IMDb ids and the queue place are as recorded.

`marker-polls-2026-10-07.json` holds what the Transfers page's 5-second poll kept
rewriting on 2026-10-07, read with a read-only session. `baseline` is the count:
sampling `Cache` every 4 seconds from 16:47 to 16:57 UTC saw 10,168 writes to
`nzbrd:` markers (8,454 completed, 1,714 failed) over 201 markers, each up to 117
times.

- `completed`: three of the most-rewritten completed markers as stored, each with
  its job as nzb2rd's `GET /jobs/:id` served it and its `xfer:` record. All three
  were already in `Available`.
- `retry`: a release whose marker read `failed` for an older job (`nzb2rd-R1`)
  while a newer DMM submission of it (`nzb2rd-R2`) sat 27th in nzb2rd's queue.
  The newer submit had recorded R2 as `pending`; the old failed row's poll put
  R1's failure back over it. That day 11 releases were in this state.

Job ids are replaced by the labels above, release ids by `ix:release-N`, and each
RD download link by a `FIXTURE` placeholder of the same shape. Account fields,
internal URLs and paths are dropped. Names, sizes, hashes, statuses, errors and
timestamps are as recorded.

`marker-clears-2026-10-09.json` holds a release whose Retry lost its `nzbrd:`
marker to the Transfers page's Clear on the failed row it replaced. `retryJob`
(`nzb2rd-C2`) was submitted at 13:48:06 UTC on 2026-10-09 and recorded `pending`;
`clear` is the request the page sent three seconds later for the old failed job
(`nzb2rd-C1`), as Nginx Proxy Manager logged it, and nzb2rd's answer. Both jobs
are nzb2rd's `GET /jobs/:id` read on 2026-10-10, so `oldJob` reads `deleted: 1`
from that clear; `retryJob` was still 98th of 942 in line. `transferMeta` is
each job's `xfer:` record. The release had no marker.

`census`: on 2026-10-10, 33 releases had a DMM retry still queued or running in
nzb2rd and no marker at all. Every one had an older job of the same release
cleared from `/transfers` after the retry was submitted, 34 clears in all, a
median of 20 seconds later, each answered `{"ok":true}`.

Job ids are replaced by the labels above and the release id by `ix:release-1`.
Account fields, internal URLs and paths, the client address and user agent are
dropped. Names, statuses, errors, timestamps and the queue place are as recorded.
