/**
 * AniList, for the anime entries Kitsu has no record of.
 *
 * Every other source the anime routes read is keyed by Kitsu, and a new season
 * reaches Kitsu late or never: on 2026-10-04 AniDB 19795 (Tougen Anki: Nikko
 * Kegon no Taki-hen, airing since 2026-10-02) had eight stored releases, MAL and
 * AniList ids in the Fribb dataset and no Kitsu id, so its page said "Unknown".
 * AniList had it. It answers by its own id or by MAL's, both of which the
 * dataset carries.
 *
 * AniList allows 30 requests a minute from one address (2026-10-04), which every
 * DMM user shares, so answers are kept in memory and a 429 pauses the lookups
 * rather than spending more of the budget.
 */

export const ANILIST_API = 'https://graphql.anilist.co';

const QUERY = `query ($id: Int, $idMal: Int) {
	Media(id: $id, idMal: $idMal, type: ANIME) {
		id idMal isAdult format episodes averageScore
		title { romaji english native }
		description(asHtml: false)
		coverImage { extraLarge large }
		bannerImage
	}
}`;

export interface AniListAnimeMeta {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	/** AniList's average score out of 100, rescaled to the 0-10 the page renders; 0 when unscored. */
	rating: number;
	/** TV, OVA, ONA, MOVIE or SPECIAL, in the `Anime` table's spelling; '' if absent. */
	type: string;
	/** Episodes AniList lists; 0 while none are announced. */
	episodeCount: number;
}

export interface AniListIds {
	anilistId?: number | null;
	malId?: number | null;
}

export type Fetcher = typeof fetch;

const FORMATS: Record<string, string> = {
	TV: 'TV',
	TV_SHORT: 'TV',
	MOVIE: 'MOVIE',
	SPECIAL: 'SPECIAL',
	OVA: 'OVA',
	ONA: 'ONA',
	MUSIC: 'SPECIAL',
};

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	'#039': "'",
	'#39': "'",
	nbsp: ' ',
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * AniList's plain-text description still carries `<br>` and `<i>` tags, which
 * the page would print literally.
 */
export function plainDescription(value: unknown): string {
	return text(value)
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/?[a-z][^>]*>/gi, '')
		.replace(/&(#0?39|#\d+|[a-z]+);/gi, (match, name: string) => {
			const known = ENTITIES[name.toLowerCase()];
			if (known !== undefined) return known;
			const code = /^#(\d+)$/.exec(name)?.[1];
			return code ? String.fromCodePoint(Number(code)) : match;
		})
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** The page's view of an AniList `Media`, or null for an adult or untitled one. */
export function normalizeAniListMedia(media: unknown): AniListAnimeMeta | null {
	if (!media || typeof media !== 'object') return null;
	const record = media as Record<string, any>;
	// The importer never adds an adult entry and Kitsu hides them; neither does this.
	if (record.isAdult === true) return null;

	const title =
		text(record.title?.romaji) || text(record.title?.english) || text(record.title?.native);
	if (!title) return null;

	const score = record.averageScore;
	const episodes = record.episodes;
	return {
		title,
		description: plainDescription(record.description),
		poster: text(record.coverImage?.extraLarge) || text(record.coverImage?.large),
		backdrop: text(record.bannerImage),
		rating: typeof score === 'number' && score > 0 && score <= 100 ? Math.round(score) / 10 : 0,
		type: FORMATS[text(record.format).toUpperCase()] ?? '',
		episodeCount: Number.isInteger(episodes) && episodes > 0 ? episodes : 0,
	};
}

/** An answer, found or not, is kept this long. */
const HIT_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 2000;
const REQUEST_TIMEOUT_MS = 10000;
/** How long to stop asking after a 429 that names no wait. */
const DEFAULT_BACKOFF_MS = 60 * 1000;

const answers = new Map<string, { meta: AniListAnimeMeta | null; expires: number }>();
const inFlight = new Map<string, Promise<AniListAnimeMeta | null>>();
let pausedUntil = 0;

function remember(key: string, meta: AniListAnimeMeta | null): void {
	if (answers.size >= MAX_ENTRIES) {
		const oldest = answers.keys().next().value;
		if (oldest !== undefined) answers.delete(oldest);
	}
	answers.set(key, { meta, expires: Date.now() + (meta ? HIT_TTL_MS : MISS_TTL_MS) });
}

async function ask(
	variables: { id: number } | { idMal: number },
	fetcher: Fetcher
): Promise<{ meta: AniListAnimeMeta | null; answered: boolean }> {
	const res = await fetcher(ANILIST_API, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ query: QUERY, variables }),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (res.status === 429) {
		const wait = Number(res.headers?.get?.('retry-after'));
		pausedUntil = Date.now() + (wait > 0 ? wait * 1000 : DEFAULT_BACKOFF_MS);
		return { meta: null, answered: false };
	}
	// An id AniList does not have is a 404 carrying `Media: null`: an answer.
	if (res.status === 404) return { meta: null, answered: true };
	if (!res.ok) return { meta: null, answered: false };
	const body = await res.json();
	return { meta: normalizeAniListMedia(body?.data?.Media), answered: true };
}

const positive = (value: number | null | undefined): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * AniList's metadata by AniList id, or by MAL id when that is all there is; null
 * when it has none, the entry is adult, or AniList cannot be asked right now.
 */
export async function fetchAniListAnime(
	ids: AniListIds,
	fetcher: Fetcher = fetch
): Promise<AniListAnimeMeta | null> {
	const variables = positive(ids.anilistId)
		? { id: ids.anilistId }
		: positive(ids.malId)
			? { idMal: ids.malId }
			: null;
	if (!variables) return null;

	const key = 'id' in variables ? `anilist:${variables.id}` : `mal:${variables.idMal}`;
	const known = answers.get(key);
	if (known && known.expires > Date.now()) return known.meta;
	if (Date.now() < pausedUntil) return null;

	const pending = inFlight.get(key);
	if (pending) return pending;

	const lookup = (async () => {
		try {
			const { meta, answered } = await ask(variables, fetcher);
			if (answered) remember(key, meta);
			return meta;
		} catch {
			return null;
		} finally {
			inFlight.delete(key);
		}
	})();
	inFlight.set(key, lookup);
	return lookup;
}

/** Test hook: forget every answer and any pause. */
export function resetAniListForTests(): void {
	answers.clear();
	inFlight.clear();
	pausedUntil = 0;
}
