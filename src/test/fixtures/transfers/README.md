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
