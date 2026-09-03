/**
 * Strip the filename patterns Real-Debrid rejects with `451 infringing_file`.
 * Same rewrite the debrid uploader service applies before building a torrent
 * (see debrid/src/naming.ts), so a title produced here matches what actually
 * lands in the RD account: `WEB-DL` -> `WEB.DL`, `BluRay.x264` -> `BluRay-x264`,
 * `BDRip` -> `BD-Rip`, `BluRay.DTS` -> `BluRay-DTS`. Newer codecs
 * (x265/HEVC/AV1) and service tags are never blocked, so they pass untouched.
 *
 * The source/codec pair here is a deliberate over-match: it rewrites all nine
 * `(bluray|hdtv|web).(x264|xvid|h264)` combinations, while RD only blocks five
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
 * name, case-insensitively: the source substrings `web-dl`/`webrip`/`bdrip`/
 * `hdrip`/`dvdrip`, exactly five source-dot-codec pairs, and `bluray.dts`.
 * Verified to pass untouched: `WEB.DL`, `WEBDL`, `WEB-Rip`, `BluRay-x264`,
 * `Blu-Ray.x264`, `BluRay.x265`, `WEB.x265` and — measured 2026-08-23 on a name
 * RD downloaded to 100% — `HDTV.H264`, which `deInfringe` rewrites but RD does
 * not block.
 *
 * `bluray.dts` was measured 2026-08-25 by adding webseed torrents built over a
 * text file, each a fresh infohash so only the name could decide it. RD refused
 * `BluRay.DTS` followed by x264, x265, H264, AC3, `DTS-HD.MA.5.1.x264` and
 * nothing at all, and refused a control release whose title had nothing to do
 * with any film. It took `BluRay.AC3.x264`, `BluRay.DD5.1.x264`,
 * `BluRay.REMUX.AVC`, `Blu-Ray.DTS.x264` and the `BluRay-DTS.x264` the rewrite
 * emits — so the trigger is `BluRay` + `.` + `DTS`, not `BluRay.` + anything.
 */
const RD_BLOCKED_NAME =
	/web-dl|(?:web|bd|hd|dvd)rip|bluray\.(?:x264|dts)|hdtv\.(?:x264|xvid)|web\.(?:x264|h264)/i;

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
