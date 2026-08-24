/**
 * TorBox mints a CDN URL as `https://<node>.tb-cdn.st/dld/<uuid>?token=<API key>`
 * - the account's raw API key rides in the query string. Cast rows kept that URL
 * verbatim in `TorBoxCast.link`, so the table held a second plaintext copy of
 * every TorBox cast user's key: 114,689 of 114,689 rows on 2026-08-24.
 *
 * Nothing reads it. Playback mints a fresh link from `torrentId`/`fileId` (or
 * from the hash), and the casted-links listing never selects the column - the
 * queries only test that it is non-null. So the token can go, and the rest of
 * the URL is kept because the column is what marks a row as castable.
 */
export const stripTorBoxToken = (link: string): string => {
	const cut = link.indexOf('?');
	if (cut < 0) return link;

	const [base, query] = [link.slice(0, cut), link.slice(cut + 1)];
	const kept = query
		.split('&')
		.filter((pair) => pair !== '' && pair.split('=')[0] !== 'token')
		.join('&');

	return kept ? `${base}?${kept}` : base;
};
