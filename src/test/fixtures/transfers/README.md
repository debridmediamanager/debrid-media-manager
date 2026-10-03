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
