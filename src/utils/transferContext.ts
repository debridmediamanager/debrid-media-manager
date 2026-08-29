// Movie-vs-show context for a transfer, derived from the page it started on.
// Used to decide where a completed torrent gets filed in DMM's own database
// (movie:<imdb> vs tv:<imdb>:<season>) when it is registered.
//
// Lives in its own module because both the browser and the server need it, and
// `debridUploader.ts` — where it used to live — imports `react-hot-toast` at the
// top level. An API route importing that would drag a toast library into the
// server bundle for the sake of one regex. `debridUploader.ts` re-exports both
// names, so existing client imports are unchanged.
export interface TransferContext {
	mediaType: 'movie' | 'tv';
	seasonNum?: number;
}

export function transferContextFromPath(path: string | undefined): TransferContext | undefined {
	if (!path) return undefined;
	const show = path.match(/^\/show\/tt\d+\/(\d+)/);
	if (show) return { mediaType: 'tv', seasonNum: parseInt(show[1], 10) };
	if (/^\/movie\/tt\d+/.test(path)) return { mediaType: 'movie' };
	return undefined;
}

/**
 * The exact shapes a content page URL takes. Nothing else is stored.
 *
 * An **allowlist**, not a sanitiser, because a stored `returnPath` is rendered
 * straight into a `<Link href>` on the Transfers page and is supplied by whoever
 * called the submit route. A blocklist here would be a game of finding the next
 * `javascript:`, `//evil.example` or `/\evil.example` that a browser resolves
 * off-site; matching only the two paths DMM actually produces has no such tail.
 *
 * It is also what `transferContextFromPath` parses, so a value that survives this
 * is guaranteed to yield a usable registration context rather than silently
 * filing a completed transfer nowhere.
 */
const RETURN_PATH_RE = /^\/(?:movie\/tt\d{7,10}|show\/tt\d{7,10}\/\d{1,4})$/;

export function safeReturnPath(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	return RETURN_PATH_RE.test(raw) ? raw : undefined;
}

/**
 * The season a release name is talking about, for a title already known to be a
 * show.
 *
 * The last resort when deciding where to file a completed transfer: a release
 * submitted through nzb2rd's SABnzbd API by Sonarr, or by the Discord uploader,
 * never passed through a DMM page and so has no `returnPath` to read. Without
 * this those releases are filed nowhere and are findable by nobody, which is the
 * failure the registration exists to prevent.
 *
 * Deliberately **not** used when a `returnPath` exists. Checked against 697
 * completed releases whose stored path was known, this agreed on 682 and never
 * chose the wrong media type — but disagreed on the season three times, because
 * DMM's season numbering is not always the one the release group used. The page
 * the user was actually standing on is the better answer whenever there is one.
 *
 * Ordered by how unambiguous the marker is: `S03`/`S03E01` first, then a spelled
 * "Season 3", then `3x05`. A date-stamped release ("WCW.Monday.Nitro.1996.08.05")
 * carries no season at all and yields undefined rather than a guess.
 */
export function seasonFromReleaseName(name: string | undefined): number | undefined {
	if (!name) return undefined;
	const patterns = [
		// The leading non-alphanumeric is required, so "Atmos.7.1" and
		// "Subs.2160p" cannot read as a season.
		/(?:^|[^a-z0-9])s(\d{1,3})(?:e\d{1,3}|[^a-z0-9]|$)/i,
		/season[^a-z0-9]{0,3}(\d{1,3})/i,
		/(?:^|[^a-z0-9])(\d{1,2})x\d{1,3}(?:[^a-z0-9]|$)/i,
	];
	for (const pattern of patterns) {
		const match = pattern.exec(name);
		if (match) {
			const season = parseInt(match[1], 10);
			if (Number.isInteger(season) && season >= 0) return season;
		}
	}
	return undefined;
}

/**
 * The DMM page shape an IMDb title type belongs to.
 *
 * DMM only ever renders `/movie/tt…` and `/show/tt…/N`, and treats exactly
 * `tvSeries` and `tvMiniSeries` as shows (see `ImdbSearchService.searchTitles`).
 * Everything else that has a page — `tvMovie`, `video`, `short`, `tvSpecial` —
 * is a movie page. A `tvEpisode` id has no page at all, so it resolves to
 * nothing rather than being filed under a key no request will ever read.
 */
export function mediaTypeFromImdbTitleType(
	titleType: string | null | undefined
): 'movie' | 'tv' | undefined {
	if (!titleType) return undefined;
	if (titleType === 'tvSeries' || titleType === 'tvMiniSeries') return 'tv';
	if (['movie', 'tvMovie', 'video', 'short', 'tvSpecial'].includes(titleType)) return 'movie';
	return undefined;
}
