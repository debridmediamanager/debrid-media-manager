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
