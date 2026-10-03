/**
 * Strip the filename patterns Real-Debrid rejects with `451 infringing_file`.
 * Same rewrite the debrid uploader service applies before building a torrent
 * (see debrid/src/naming.ts), so a title produced here matches what actually
 * lands in the RD account: `WEB-DL` -> `WEB.DL`, `BluRay.x264` -> `BluRay-x264`,
 * `BDRip` -> `BD-Rip`, `BluRay.DTS` -> `BluRay-DTS`. Newer codecs
 * (x265/HEVC/AV1) and service tags are never blocked, so they pass untouched.
 *
 * The source/codec pair here is a deliberate over-match: it rewrites all nine
 * `(bluray|hdtv|web).(x264|xvid|h264)` combinations, while RD only blocks four
 * of them (see `RD_BLOCKED_NAME`). Breaking a pattern RD would have accepted
 * costs nothing but a cosmetic change to the name, and keeping the expression
 * identical to debrid's is what guarantees the title computed here matches the
 * torrent that service creates. Do not narrow it without narrowing that one.
 */
export function deInfringe(name: string): string {
	return name
		.replace(/(bluray|hdtv|web)\.(x264|xvid|h264)/gi, '$1-$2')
		.replace(/bluray\.dts/gi, (m) => m.replace('.', '-'))
		.replace(/web-dl/gi, (m) => m.replace('-', '.'))
		.replace(/(web|bd|hd|dvd)rip/gi, (m) => m.replace(/rip$/i, (r) => `-${r}`));
}

/**
 * The patterns RD has actually been measured to reject, matched anywhere in a
 * name, case-insensitively: the substring `web-dl` and exactly four
 * source-dot-codec pairs. Verified to pass untouched: `WEB.DL`, `WEBDL`,
 * `WEB-Rip`, `BluRay-x264`, `Blu-Ray.x264`, `BluRay.x265`, `WEB.x265` and —
 * measured 2026-08-23 on a name RD downloaded to 100% — `HDTV.H264`, which
 * `deInfringe` rewrites but RD does not block.
 *
 * Re-measured 2026-10-03 with a fresh `.torrent` per name
 * (`src/test/fixtures/realdebrid/rd-name-filter-2026-10-03.json`): RD took
 * `WEBRip`, `BDRip`, `HDRip`, `DVDRip`, `BluRay.x264` and `BluRay.DTS`, all of
 * which it had refused until September, and still refused `WEB-DL`,
 * `HDTV.x264`, `HDTV.XviD`, `WEB.x264` and `WEB.H264`. `deInfringe` still
 * rewrites the dropped ones, which costs nothing.
 */
const RD_BLOCKED_NAME = /web-dl|hdtv\.(?:x264|xvid)|web\.(?:x264|h264)/i;

/**
 * Whether RD blocks this torrent outright, judged on its display title *and*
 * whatever filenames the caller knows.
 *
 * This is the only reliable way to read a `451 infringing_file`: RD returns
 * that status both for a genuinely blocked name and as a throttle penalty
 * during a burst of adds, and the throttle form arrives well before RD ever
 * escalates to an honest 429. A blocked name is deterministic — refused on the
 * first request, every time — so when the name is clean, a 451 means slow down
 * and retry, not that the content is gone.
 *
 * **RD reads the paths inside the torrent, not just its root name, and a
 * display title can lose the very dots the block needs.** Measured 2026-09-03
 * on `25f9ffaf…`: the title everything here had to work with was `Soul Power
 * The Legend of the American Basketball Association S01E04 1080p WEB h264-GRACE`
 * — space-separated, so clean by this test — while the actual path in the
 * torrent was `Soul.Power.….1080p.WEB.h264-GRACE[EZTVx.to]/….mkv`, which is a
 * `web.h264` hit. RD refused it on request #1 between two accepted controls, so
 * it was a real block, and reading only the title called it a throttle and sat
 * through two 20-second backoffs before giving up with the wrong message.
 * Widening the *pattern* to treat a space as a separator would be wrong in the
 * other direction — the uploader's rewrite of that same release, named with
 * spaces, is in RD and downloaded fine.
 *
 * Unlike `deInfringe`, this matches only the measured patterns. It gates a
 * destructive, shared-state deletion, so a false positive is far more expensive
 * than a false negative here — which is why filenames are an argument the
 * caller supplies rather than something guessed at, and an empty list leaves
 * the answer exactly as the title alone gives it.
 */
export function isRdBlockedName(name: string, filenames: readonly string[] = []): boolean {
	if (RD_BLOCKED_NAME.test(name)) return true;
	return filenames.some((filename) => RD_BLOCKED_NAME.test(filename));
}
