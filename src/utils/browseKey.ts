/**
 * A browse list item, `show:tt22248376:Frieren: Beyond Journey's End`.
 *
 * The title is the rest of the key and may hold colons of its own. Splitting
 * on every colon dropped such titles from /browse: 12 of the 96 items
 * production listed under /browse/anime on 2026-09-27, Frieren and Fullmetal
 * Alchemist: Brotherhood among them, never rendered.
 */
export interface BrowseKey {
	mediaType: string;
	imdbid: string;
	title: string;
}

export function parseBrowseKey(key: string): BrowseKey | null {
	const match = /^([^:]+):([^:]+):(.*)$/s.exec(key);
	if (!match || !match[2]) return null;
	return { mediaType: match[1], imdbid: match[2], title: match[3] };
}
