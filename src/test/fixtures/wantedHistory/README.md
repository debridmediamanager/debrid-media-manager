# Reports a real zurg sent

`zurg-report-1.json` and `zurg-report-2.json` are the bodies zurg's acquisition engine
posted to `POST /api/sponsor/wanted/history` on 2026-11-19, recorded by zurg's
`TestLiveTwoZurgsAgainstDMM` against a DMM dev server with a scratch database (zurg
`feat/wanted-history-gaps`). Reformatted with `jq .`, otherwise as sent. The titles
were Dune: Part Two and Chernobyl; the item ids are that scratch database's.

Record them again with that test (`ZURG_LIVE_RECORD=<dir>`) whenever zurg changes what
it sends, so DMM's parser is held to what zurg writes and not to a hand-written guess.

`zurg-report-3.json` is from 2026-11-20, zurg's `TestLiveAnNZBIsUploadedAndHandedOn`: the
report of an install that took an NZB another sponsor's zurg had uploaded, fetched from a
DMM with a real store. Its `dmm_id` is a grab token minted under that test DMM's secret.
