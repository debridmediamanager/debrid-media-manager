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

/**
 * Kitsu returns ids as strings; callers index the local table by number.
 *
 * Null means Kitsu could not be asked, which is not the same answer as the
 * empty list it gives for a keyword nothing matches: the search route used to
 * read both as an outage and answered a no-match search with a 500.
 */
export async function searchKitsuAnimeIds(
	keyword: string,
	fetcher: Fetcher = fetch,
	limit = 20
): Promise<number[] | null> {
	const query = keyword.trim();
	if (!query) return [];

	try {
		const url =
			`${KITSU_API_BASE}/anime?filter%5Btext%5D=${encodeURIComponent(query)}` +
			`&page%5Blimit%5D=${limit}`;
		const res = await fetcher(url, { headers: JSON_API_HEADERS });
		if (!res.ok) return null;
		const body = await res.json();
		if (!Array.isArray(body?.data)) return null;

		return body.data
			.map((entry: { id?: unknown }) => parseInt(String(entry?.id ?? ''), 10))
			.filter((id: number) => Number.isInteger(id) && id > 0);
	} catch {
		return null;
	}
}

/** What the importer takes from Kitsu for one anime. */
export interface KitsuImportMeta {
	kitsuId: number;
	canonicalTitle: string;
	/** Every localised title Kitsu carries, `en` first. */
	titles: string[];
	synopsis: string;
	/** The `medium` rendition first, which is what existing rows store. */
	poster: string;
	cover: string;
	/** 0-10, as `normalizeKitsuAnime` scales it; 0 when Kitsu has no score. */
	rating: number;
	/** `TV`, `movie`, `OVA`, `ONA`, `special` or `music`. */
	subtype: string | null;
	nsfw: boolean;
	ageRating: string | null;
	startDate: string | null;
}

/** Kitsu's own ceiling for `page[limit]` on the anime collection. */
export const KITSU_BATCH_SIZE = 20;

/**
 * Kitsu answered Python's default user agent with a Cloudflare 403 on
 * 2026-09-27, so the importer names itself rather than relying on whatever
 * default the runtime sends.
 */
export const KITSU_IMPORT_USER_AGENT = 'dmm-anime-import/1.0 (+https://debridmediamanager.com)';

const IMPORT_FIELDS = [
	'canonicalTitle',
	'titles',
	'synopsis',
	'description',
	'posterImage',
	'coverImage',
	'averageRating',
	'subtype',
	'nsfw',
	'ageRating',
	'startDate',
].join(',');

export function normalizeKitsuImport(entry: {
	id?: unknown;
	attributes?: Record<string, unknown>;
}): KitsuImportMeta | null {
	const kitsuId = parseInt(String(entry?.id ?? ''), 10);
	const attributes = entry?.attributes;
	if (!Number.isInteger(kitsuId) || kitsuId <= 0 || !attributes) return null;

	const base = normalizeKitsuAnime(attributes);
	const rawTitles =
		attributes.titles && typeof attributes.titles === 'object'
			? (attributes.titles as Record<string, unknown>)
			: {};
	const titles = Object.entries(rawTitles)
		.filter((pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1] !== '')
		.sort(([a], [b]) => (a === 'en' ? -1 : b === 'en' ? 1 : 0))
		.map(([, title]) => title);

	return {
		kitsuId,
		canonicalTitle: base.title,
		titles,
		synopsis: base.description,
		poster: pickImage(attributes.posterImage, ['medium', 'large', 'small', 'original']),
		cover: pickImage(attributes.coverImage, ['large', 'original', 'small']),
		rating: base.rating,
		subtype: typeof attributes.subtype === 'string' ? attributes.subtype : null,
		nsfw: attributes.nsfw === true,
		ageRating: typeof attributes.ageRating === 'string' ? attributes.ageRating : null,
		startDate: typeof attributes.startDate === 'string' ? attributes.startDate : null,
	};
}

export interface KitsuBatchResult {
	metas: Map<number, KitsuImportMeta>;
	requests: number;
	/** Batches that still failed after their retries. Their ids are simply absent. */
	failedBatches: number;
	batches: number;
}

export interface KitsuBatchOptions {
	fetcher?: Fetcher;
	/** Pause between requests. Kitsu publishes no limit; one a second is polite. */
	delayMs?: number;
	retries?: number;
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Look up many anime, twenty per request through `filter[id]`.
 *
 * An id Kitsu leaves out of its answer is one it no longer has, or one it
 * hides from anonymous callers (its adult catalogue), and is absent from the
 * result either way. A 429 or 5xx is retried after `Retry-After` or a growing
 * pause; anything else fails that batch and is counted, not thrown, so one bad
 * batch costs twenty titles rather than the run.
 */
export async function fetchKitsuAnimeBatch(
	kitsuIds: number[],
	options: KitsuBatchOptions = {}
): Promise<KitsuBatchResult> {
	const fetcher = options.fetcher ?? fetch;
	const delayMs = options.delayMs ?? 1000;
	const retries = options.retries ?? 2;
	const sleep = options.sleep ?? defaultSleep;

	const unique = Array.from(new Set(kitsuIds.filter((id) => Number.isInteger(id) && id > 0)));
	const result: KitsuBatchResult = {
		metas: new Map(),
		requests: 0,
		failedBatches: 0,
		batches: 0,
	};

	for (let start = 0; start < unique.length; start += KITSU_BATCH_SIZE) {
		const batch = unique.slice(start, start + KITSU_BATCH_SIZE);
		result.batches++;
		const url =
			`${KITSU_API_BASE}/anime?filter%5Bid%5D=${batch.join(',')}` +
			`&page%5Blimit%5D=${KITSU_BATCH_SIZE}&fields%5Banime%5D=${IMPORT_FIELDS}`;

		let done = false;
		for (let attempt = 0; attempt <= retries && !done; attempt++) {
			if (result.requests > 0) await sleep(delayMs);
			result.requests++;
			try {
				const res = await fetcher(url, {
					headers: { ...JSON_API_HEADERS, 'User-Agent': KITSU_IMPORT_USER_AGENT },
				});
				if (res.status === 429 || res.status >= 500) {
					const retryAfter = Number(res.headers.get('retry-after'));
					await sleep(
						Number.isFinite(retryAfter) && retryAfter > 0
							? retryAfter * 1000
							: delayMs * 5 * (attempt + 1)
					);
					continue;
				}
				if (!res.ok) break;
				const body = await res.json();
				if (!Array.isArray(body?.data)) break;
				for (const entry of body.data) {
					const meta = normalizeKitsuImport(entry);
					if (meta) result.metas.set(meta.kitsuId, meta);
				}
				done = true;
			} catch {
				// A dropped connection is worth the same retry a 5xx gets.
				await sleep(delayMs * 5 * (attempt + 1));
			}
		}
		if (!done) result.failedBatches++;
	}
	return result;
}
