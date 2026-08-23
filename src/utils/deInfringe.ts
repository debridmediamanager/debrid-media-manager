/**
 * Strip the filename patterns Real-Debrid rejects with `451 infringing_file`.
 * Same rewrite the debrid uploader service applies before building a torrent
 * (see debrid/src/naming.ts), so a title produced here matches what actually
 * lands in the RD account: `WEB-DL` -> `WEB.DL`, `BluRay.x264` -> `BluRay-x264`,
 * `BDRip` -> `BD-Rip`. Newer codecs (x265/HEVC/AV1) and service tags are never
 * blocked, so they pass untouched.
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
		.replace(/web-dl/gi, (m) => m.replace('-', '.'))
		.replace(/(web|bd|hd|dvd)rip/gi, (m) => m.replace(/rip$/i, (r) => `-${r}`));
}

/**
 * The patterns RD has actually been measured to reject, matched anywhere in a
 * name, case-insensitively: the source substrings `web-dl`/`webrip`/`bdrip`/
 * `hdrip`/`dvdrip`, and exactly five source-dot-codec pairs. Verified to pass
 * untouched: `WEB.DL`, `WEBDL`, `WEB-Rip`, `BluRay-x264`, `Blu-Ray.x264`,
 * `BluRay.x265`, `WEB.x265` and — measured 2026-08-23 on a name RD downloaded
 * to 100% — `HDTV.H264`, which `deInfringe` rewrites but RD does not block.
 */
const RD_BLOCKED_NAME =
	/web-dl|(?:web|bd|hd|dvd)rip|bluray\.x264|hdtv\.(?:x264|xvid)|web\.(?:x264|h264)/i;

/**
 * Whether RD blocks this filename outright.
 *
 * This is the only reliable way to read a `451 infringing_file`: RD returns
 * that status both for a genuinely blocked name and as a throttle penalty
 * during a burst of adds, and the throttle form arrives well before RD ever
 * escalates to an honest 429. A blocked name is deterministic — refused on the
 * first request, every time — so when the name is clean, a 451 means slow down
 * and retry, not that the content is gone.
 *
 * Unlike `deInfringe`, this matches only the measured patterns. It gates a
 * destructive, shared-state deletion, so a false positive is far more expensive
 * than a false negative here.
 */
export function isRdBlockedName(name: string): boolean {
	return RD_BLOCKED_NAME.test(name);
}
