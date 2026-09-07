/**
 * The official Kitsu API, used as a fallback for `anime-kitsu.strem.fun`.
 *
 * The addon is a community-run Stremio endpoint with no SLA; when it is slow or
 * down, anime pages lose their title, art and rating entirely. Kitsu publishes
 * the same catalogue itself, so the addon staying the primary source costs
 * nothing and its outage stops being fatal.
 *
 * Kitsu carries no IMDb id, so callers that need one resolve it separately —
 * the local `Anime` table is keyed by `kitsu_id` and now carries far more IMDb
 * ids than it did.
 */

export const KITSU_API_BASE = 'https://kitsu.io/api/edge';

export interface KitsuAnimeMeta {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	/**
	 * Kitsu scores out of 100; rescaled to the 0-10 the UI renders. This is
	 * Kitsu's community score, not IMDb's, and only stands in when the addon
	 * (which does carry IMDb's) is unavailable.
	 */
	rating: number;
}

export type Fetcher = typeof fetch;

const JSON_API_HEADERS = { Accept: 'application/vnd.api+json' };

function pickImage(image: unknown, keys: string[]): string {
	if (!image || typeof image !== 'object') return '';
	const record = image as Record<string, unknown>;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'string' && value !== '') return value;
	}
	return '';
}

function rescaleRating(averageRating: unknown): number {
	const value = typeof averageRating === 'string' ? parseFloat(averageRating) : averageRating;
	if (typeof value !== 'number' || Number.isNaN(value)) return 0;
	// Guard against a future scale change rather than emitting a 40-star rating.
	if (value < 0 || value > 100) return 0;
	return Math.round((value / 10) * 10) / 10;
}

export function normalizeKitsuAnime(attributes: Record<string, unknown>): KitsuAnimeMeta {
	const title =
		(typeof attributes.canonicalTitle === 'string' && attributes.canonicalTitle) || '';
	const description =
		(typeof attributes.synopsis === 'string' && attributes.synopsis) ||
		(typeof attributes.description === 'string' && attributes.description) ||
		'';
	return {
		title,
		description,
		poster: pickImage(attributes.posterImage, ['original', 'large', 'medium', 'small']),
		backdrop: pickImage(attributes.coverImage, ['original', 'large', 'small']),
		rating: rescaleRating(attributes.averageRating),
	};
}

export async function fetchKitsuAnime(
	kitsuId: string | number,
	fetcher: Fetcher = fetch
): Promise<KitsuAnimeMeta | null> {
	const id = String(kitsuId).trim();
	if (!/^\d+$/.test(id)) return null;

	try {
		const res = await fetcher(`${KITSU_API_BASE}/anime/${id}`, { headers: JSON_API_HEADERS });
		if (!res.ok) return null;
		const body = await res.json();
		const attributes = body?.data?.attributes;
		if (!attributes || typeof attributes !== 'object') return null;

		const meta = normalizeKitsuAnime(attributes);
		return meta.title ? meta : null;
	} catch {
		return null;
	}
}

/** Kitsu returns ids as strings; callers index the local table by number. */
export async function searchKitsuAnimeIds(
	keyword: string,
	fetcher: Fetcher = fetch,
	limit = 20
): Promise<number[]> {
	const query = keyword.trim();
	if (!query) return [];

	try {
		const url =
			`${KITSU_API_BASE}/anime?filter%5Btext%5D=${encodeURIComponent(query)}` +
			`&page%5Blimit%5D=${limit}`;
		const res = await fetcher(url, { headers: JSON_API_HEADERS });
		if (!res.ok) return [];
		const body = await res.json();
		if (!Array.isArray(body?.data)) return [];

		return body.data
			.map((entry: { id?: unknown }) => parseInt(String(entry?.id ?? ''), 10))
			.filter((id: number) => Number.isInteger(id) && id > 0);
	} catch {
		return [];
	}
}
