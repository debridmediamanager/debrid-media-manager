/**
 * Every title and synonym manami's anime-offline-database carries for an AniDB entry: the
 * names MyAnimeList, AniList, Kitsu and AniDB give it, which is how fansub groups name their
 * releases. The `Anime` table holds AniDB's titles alone, which name `Hajime no Ippo: The
 * Fighting! - New Challenger` and never `Hajime no Ippo New Challenger`, the release name.
 *
 * The dataset is one JSON object a line (about 60 MB, published weekly), so it is read as
 * it streams and only the entries the caller asks for are kept.
 */

export const ANIME_OFFLINE_DATABASE_URL =
	'https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database.jsonl';

const ANIDB_SOURCE = /anidb\.net\/anime\/(\d+)$/;

/** One line of the dataset: the AniDB ids its entry is, and its title and synonyms. */
export function namesOfLine(line: string): { anidbIds: number[]; names: string[] } | null {
	let row: any;
	try {
		row = JSON.parse(line);
	} catch {
		return null;
	}
	const anidbIds = (Array.isArray(row?.sources) ? row.sources : []).flatMap((source: unknown) => {
		const id = typeof source === 'string' ? ANIDB_SOURCE.exec(source)?.[1] : undefined;
		return id ? [Number(id)] : [];
	});
	if (anidbIds.length === 0) return null;
	const names = [row.title, ...(Array.isArray(row.synonyms) ? row.synonyms : [])].filter(
		(name): name is string => typeof name === 'string' && name.trim() !== ''
	);
	return { anidbIds, names };
}

export type Fetcher = typeof fetch;

/** The dataset is published weekly. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 120 * 1000;

let cached: { names: Map<number, string[]>; loadedAt: number } | null = null;
let lastFailureAt = 0;
let inFlight: Promise<Map<number, string[]> | null> | null = null;

async function download(
	wanted: (anidbId: number) => boolean,
	fetcher: Fetcher
): Promise<Map<number, string[]> | null> {
	try {
		const res = await fetcher(ANIME_OFFLINE_DATABASE_URL, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
		const names = new Map<number, string[]>();
		const add = (line: string) => {
			const entry = line.trim() ? namesOfLine(line) : null;
			for (const id of entry?.anidbIds ?? []) {
				if (wanted(id)) names.set(id, [...(names.get(id) ?? []), ...entry!.names]);
			}
		};
		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		let rest = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const lines = (rest + value).split('\n');
			rest = lines.pop() ?? '';
			lines.forEach(add);
		}
		add(rest);
		cached = { names, loadedAt: Date.now() };
		return names;
	} catch (error) {
		lastFailureAt = Date.now();
		console.error(
			'Could not load the anime-offline-database:',
			error instanceof Error ? error.message : 'unknown error'
		);
		return cached?.names ?? null;
	}
}

/**
 * Synonyms by AniDB id for the entries `wanted` accepts, downloaded on first use and weekly
 * after that; null until a download has succeeded.
 * ponytail: `wanted` is read at download time, so an entry the Fribb dataset maps after
 * that gets its synonyms at the next weekly download (it still has its `Anime` titles).
 */
export async function getAnimeSynonyms(
	wanted: (anidbId: number) => boolean,
	fetcher: Fetcher = fetch
): Promise<Map<number, string[]> | null> {
	const now = Date.now();
	if (cached && now - cached.loadedAt < TTL_MS) return cached.names;
	if (now - lastFailureAt < RETRY_AFTER_FAILURE_MS) return cached?.names ?? null;
	if (!inFlight) {
		inFlight = download(wanted, fetcher).finally(() => {
			inFlight = null;
		});
	}
	return inFlight;
}

/** Test hook: forget the downloaded synonyms. */
export function resetAnimeSynonymsForTests(): void {
	cached = null;
	lastFailureAt = 0;
	inFlight = null;
}
