/**
 * Strip the filename patterns Real-Debrid rejects with `451 infringing_file`
 * (see `RD_BLOCKED_NAME`), plus the source/codec pairs it takes: every extra
 * rewrite is deliberate, see below.
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
 * The eleven strings RD refuses, matched anywhere in a name and in any case:
 * `WEB-DL`, `WEBRip`, `BDRip`, `HDRip`, `DVDRip`, `WEB.x264`, `WEB.h264`,
 * `HDTV.x264`, `HDTV.XviD`, `BluRay.x264` and `BluRay.DTS` (whatever follows
 * it). Only the dot or hyphen shown counts, so `WEB.DL`, `WEBDL`, `WEB-Rip`,
 * `BD-Rip`, `BluRay-x264`, `BluRay-DTS` and `WEB-x264` pass, as do
 * `HDTV.H264`, `DTS.x264` and `WEB.DTS`, while `WEB-DLRip` and `PreDVDRip`
 * contain a pattern.
 *
 * Re-measured 2026-10-10 over 102 adds and 12 unrestricts, each a fresh
 * webseed torrent so only the names decided
 * (`src/test/fixtures/realdebrid/rd-name-filter-2026-10-10.json`). On
 * 2026-10-03 RD had shrunk this to five case-sensitive literals; a week later
 * it was back to the 2026-08-25 list, case-insensitive again.
 */
const RD_BLOCKED_NAME =
	/web-dl|(?:web|bd|hd|dvd)rip|bluray\.(?:x264|dts)|hdtv\.(?:x264|xvid)|web\.(?:x264|h264)/i;

/**
 * Whether RD blocks this torrent outright, judged on its display title *and*
 * whatever filenames the caller knows.
 *
 * This is the only reliable way to read a `451 infringing_file`: RD returns
 * that status both for a genuinely blocked name and, far more often, while it
 * refuses every add on the account for a while (21 s to about five minutes,
 * measured 2026-10-04/05; see `rdAddPause.ts`), with no 429 anywhere. A blocked
 * name is deterministic — refused on the first request, every time — so when
 * the name is clean, a 451 means wait and retry, not that the content is gone.
 *
 * **RD applies the rule to two different names.** An add is judged on the
 * torrent's root name alone: on 2026-10-03 and again on 2026-10-10 it took
 * packs whose files were named `WEB-DL` and `HDTV.x264`, then refused
 * `/unrestrict/link` on exactly those files with the same 451. So a filename
 * hit means files that will never stream, which is what the season-pack filter
 * needs, while an add refusal is the root name's. That root name is not always the display title: on
 * 2026-09-03 `25f9ffaf…`, titled `… 1080p WEB h264-GRACE` with spaces, was
 * refused for its root folder `….WEB.h264-GRACE[EZTVx.to]/`, a name only the
 * file paths reveal.
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
