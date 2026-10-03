Uploader `GET /jobs/:id` bodies captured from debrid02 on 2026-10-03 for jobs
their submitters had cancelled from the Transfers page. The job, hash and IMDb
ids are real; the TorBox and Real-Debrid user ids and the webseed host are
replaced.

A cancel sets `deleted: 1` and leaves the status where the job was, so each of
these still answered as a transfer in progress:

- `job-cancelled-uploading.json`: cancelled while Real-Debrid sat at 0%.
- `job-cancelled-pending.json`: cancelled while waiting in line.
- `job-cancelled-downloading.json`: cancelled while fetching the torrent.
- `job-cancelled-claimed-request.json`: the job behind a request-board claim,
  cancelled on 2026-09-21. The claim was still open on 2026-10-03.

`tbrd-cancelled-mappings.json`: the `tbrd:` records DMM held for the first three
jobs, read from the `Cache` table the same day. 222 of the 224 `pending`
records pointed at a job in this state.

`claimed-request-cancelled-job.json`: the `ContentRequest` row for that claim,
with the requester and fulfiller ids replaced. All four claims on the board
that day were waiting on a cancelled job.
