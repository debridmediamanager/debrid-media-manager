import { ScrapeSearchResult, isUsableHash } from './mediasearch';

/**
 * Debridio (addon.debridio.com) as a torrent and availability source.
 *
 * The addon config URL embeds a provider API key, so it is only ever read
 * server-side from DEBRIDIO_ADDON_URL and must never reach the client. Stream
 * listings need no valid provider key for hot titles, but a cache miss costs an
 * instant-availability call against the embedded key - keep that key on an
 * account whose quota you are willing to spend.
 *
 * Wire format notes, all measured against the live addon:
 * - `url` is `/play/{type}/{provider}/{api key}/{provider key}/{infohash}/{filename}`
 * - `title` line 1 is the release name, the rest is emoji metadata
 * - `💾 N GB` in the title is 1024-base ("56.99 GB" == 61,188,068,208 bytes,
 *   verified against the RD Content-Range of the same file)
 * - `name` contains ⚡ when the hash is cached on Real-Debrid
 */

export type DebridioInstantRow = {
	hash: string;
	filename: string;
	bytes: number;
};

export type DebridioScrape = {
	torrents: ScrapeSearchResult[];
	available: DebridioInstantRow[];
};

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;
// Listings carry junk - sample files, deleted scenes, stray 12 MB "1080p"
// entries. A real release is never under 100 MB; entries without a size marker
// are kept because a missing marker means format drift, not a small torrent.
const MIN_TORRENT_BYTES = 100 * BYTES_PER_MB;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_EPISODES_PER_SEASON = 40;
const EPISODE_CONCURRENCY = 5;
const CHUNK_PAUSE_MS = 250;

const SIZE_MARKER = /💾\s*([\d.]+)\s*(KB|MB|GB)/i;

type ParsedStream = {
	hash: string;
	title: string;
	filename: string;
	bytes: number;
	cached: boolean;
};

export type DebridioProvider = 'realdebrid' | 'alldebrid';

const ENV_BY_PROVIDER: Record<DebridioProvider, string> = {
	realdebrid: 'DEBRIDIO_ADDON_URL',
	alldebrid: 'DEBRIDIO_ALLDEBRID_URL',
};

function addonBase(provider: DebridioProvider): string | null {
	const raw = process.env[ENV_BY_PROVIDER[provider]]?.trim();
	if (!raw) return null;
	// Accept both the bare config URL and a full manifest.json paste.
	const base = raw.replace(/\/manifest\.json\/?$/i, '').replace(/\/+$/, '');
	return base.startsWith('https://') ? base : null;
}

export function configuredDebridioProviders(): DebridioProvider[] {
	return (['realdebrid', 'alldebrid'] as const).filter((p) => addonBase(p) !== null);
}

export function isDebridioEnabled(): boolean {
	return configuredDebridioProviders().length > 0;
}

export function parseBytes(displayTitle: string): number {
	const match = SIZE_MARKER.exec(displayTitle);
	if (!match) return 0;
	const value = parseFloat(match[1]);
	if (Number.isNaN(value)) return 0;
	switch (match[2].toUpperCase()) {
		case 'GB':
			return Math.round(value * BYTES_PER_GB);
		case 'MB':
			return Math.round(value * BYTES_PER_MB);
		default:
			return Math.round(value * BYTES_PER_KB);
	}
}

function hashFromPlayUrl(url: unknown): string | null {
	if (typeof url !== 'string') return null;
	const hash = url.split('/')[8];
	return isUsableHash(hash) ? hash : null;
}

function collectStreams(payloads: unknown[]): unknown[] {
	const streams: unknown[] = [];
	for (const payload of payloads) {
		const candidate = (payload as { streams?: unknown } | null)?.streams;
		if (Array.isArray(candidate)) streams.push(...candidate);
	}
	return streams;
}

/**
 * Turns one or more debridio stream responses into scrape rows plus the
 * cached-on-RD subset. Multiple payloads (a season fanned out per episode) are
 * merged by hash: the cached flag ORs, and the larger size wins so an episode
 * query that saw the full pack is not overwritten by a partial one.
 */
export function parseDebridioStreams(payloads: unknown | unknown[]): DebridioScrape {
	const list = Array.isArray(payloads) ? payloads : [payloads];
	const byHash = new Map<string, ParsedStream>();

	for (const stream of collectStreams(list)) {
		const s = stream as Record<string, unknown>;
		const hash = hashFromPlayUrl(s.url);
		if (!hash) continue;

		const fullTitle = typeof s.title === 'string' ? s.title : '';
		const title = fullTitle.split('\n')[0].trim();
		if (!title) continue;
		// Stored results must stay source-anonymous: the `name` field carries
		// debridio branding but is never read, and if a listing ever leaked the
		// brand into a title, the entry is dropped rather than shown.
		if (title.toLowerCase().includes('debridio')) continue;

		const bytes = parseBytes(fullTitle);
		if (bytes > 0 && bytes < MIN_TORRENT_BYTES) continue;

		const behaviorHints = s.behaviorHints as Record<string, unknown> | undefined;
		const filename =
			(typeof behaviorHints?.filename === 'string' && behaviorHints.filename) || title;
		const cached = typeof s.name === 'string' && s.name.includes('⚡');

		const existing = byHash.get(hash);
		if (!existing) {
			byHash.set(hash, { hash, title, filename, bytes, cached });
			continue;
		}
		existing.cached = existing.cached || cached;
		if (bytes > existing.bytes) {
			existing.bytes = bytes;
			existing.filename = filename;
		}
	}

	const torrents: ScrapeSearchResult[] = [];
	const available: DebridioInstantRow[] = [];
	for (const s of byHash.values()) {
		torrents.push({
			title: s.title,
			fileSize: Number((s.bytes / BYTES_PER_MB).toFixed(2)),
			hash: s.hash,
		});
		if (s.cached) {
			available.push({ hash: s.hash, filename: s.filename, bytes: s.bytes });
		}
	}
	return { torrents, available };
}

async function fetchStreams(url: string): Promise<unknown> {
	const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!response.ok) {
		throw new Error(`debridio responded ${response.status}`);
	}
	return response.json();
}

export async function scrapeDebridioMovie(
	imdbId: string,
	provider: DebridioProvider = 'realdebrid'
): Promise<DebridioScrape> {
	const base = addonBase(provider);
	if (!base) throw new Error(`${ENV_BY_PROVIDER[provider]} is not configured`);
	return parseDebridioStreams(await fetchStreams(`${base}/stream/movie/${imdbId}.json`));
}

export async function scrapeDebridioSeason(
	imdbId: string,
	season: number,
	episodes: number[],
	provider: DebridioProvider = 'realdebrid'
): Promise<DebridioScrape> {
	const base = addonBase(provider);
	if (!base) throw new Error(`${ENV_BY_PROVIDER[provider]} is not configured`);
	const list = episodes.slice(0, MAX_EPISODES_PER_SEASON);
	if (list.length === 0) throw new Error('no episodes to scrape');

	// Fire the whole season at once and debridio's edge rejects the burst -
	// measured in production 2026-08-31: single episode requests answer in
	// under a second while a 20-40 wide fan-out from one container (times four
	// swarm replicas) came back with every request failed. Chunked with a short
	// pause keeps a full season around 2-8s while staying under the burst
	// limit; a chunk's failures cost their own requests only, the healthy
	// episodes still land.
	const payloads: unknown[] = [];
	for (let start = 0; start < list.length; start += EPISODE_CONCURRENCY) {
		const chunk = list.slice(start, start + EPISODE_CONCURRENCY);
		const settled = await Promise.allSettled(
			chunk.map((episode) =>
				fetchStreams(`${base}/stream/series/${imdbId}:${season}:${episode}.json`)
			)
		);
		for (const result of settled) {
			if (result.status === 'fulfilled') payloads.push(result.value);
		}
		if (start + EPISODE_CONCURRENCY < list.length) {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, CHUNK_PAUSE_MS);
			await promise;
		}
	}
	if (payloads.length === 0) {
		throw new Error('all debridio episode requests failed');
	}
	return parseDebridioStreams(payloads);
}
