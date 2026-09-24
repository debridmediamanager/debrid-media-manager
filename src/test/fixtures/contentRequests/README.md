Uploader `GET /jobs/:id` bodies for two production content-request fulfilments,
captured 2026-09-24 from debrid02. The job, hash and IMDb ids are real; the
TorBox and Real-Debrid user ids and the webseed host are replaced.

- `job-failed-uncached.json`: the fulfiller's TorBox did not have the release.
  219 of the 369 requests marked "Sent" at the time ended this way.
- `job-completed.json`: one of the 43 that reached the asker.

TorBox `POST /v1/api/torrents/checkcached?format=list&list_files=false`
answers, captured 2026-09-24 with a trial account:

- `tb-checkcached-uncached.json`: the uncached job's hash alone. `data` is an
  empty list, not null.
- `tb-checkcached-batch.json`: both hashes in one call. Only the cached one
  comes back, so membership is the answer.
