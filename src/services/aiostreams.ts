import { DebridioScrape, scrapeStremioMovie, scrapeStremioSeason } from './debridio';
import { ScrapeSearchResult, isUsableHash } from './mediasearch';

/**
 * AIOStreams as one more torrent source: a single saved configuration that
 * fans a request out to Comet, StremThru Torz, MediaFusion, Torrentio, Meteor,
 * Peerflix, TorrentsDB, Zilean, Bitmagnet and the rest, and answers with every
 * torrent they know - measured 2026-11-07 on The Odyssey (2026), 1,277 streams
 * in 6.8 s, among them four 80+ GB remuxes nothing else DMM reads had.
 *
 * `AIOSTREAMS_URL` is the configuration's addon base,
 * `https://<instance>/stremio/<uuid>/<encrypted password>`. The configuration
 * names each stream after its preset (`name` = `{addon.presetId}`) and puts
 * the torrent's folder name, then the file name, in `description`; that is the
 * wire format read here. Its debrid key is a TorBox trial account's and is only
 * used there for cache checks, which is why no availability is taken from it.
 */
export function aioStreamsBase(): string | null {
	const raw = process.env.AIOSTREAMS_URL?.trim();
	if (!raw) return null;
	const base = raw.replace(/\/manifest\.json\/?$/i, '').replace(/\/+$/, '');
	return base.startsWith('https://') ? base : null;
}

/**
 * Presets that look a title up by its IMDb id, so what they return is that
 * title's. The rest (Bitmagnet, Zilean, Knaben, TorrentGalaxy...) search by
 * name and bring back other films with the same words, so their releases must
 * pass DMM's own title check first.
 */
export const AIOSTREAMS_ID_SOURCES = new Set([
	'torrentio',
	'comet',
	'meteor',
	'mediafusion',
	'stremthruTorz',
	'torrents-db',
	'peerflix',
	'fkstream',
	'brazuca-torrents',
]);

// Same floor as debridio's: sample files and stray clips are never a release.
const MIN_RELEASE_BYTES = 100 * 1024 * 1024;
// Answers in ~7 s for a film; its own per-source timeout is 15 s.
const AIOSTREAMS_TIMEOUT_MS = 45_000;

const HASH_SEGMENT = /^[0-9a-f]{40}$/i;
const MAGNET_HASH = /btih:([0-9a-f]{40})/i;

/**
 * The torrent's info hash. With a debrid service configured most sources
 * answer with a playback URL instead of `infoHash` - measured 2026-11-07, 1,124
 * of 1,277 streams - and the hash rides in it one of three ways: a path
 * segment (Comet, Torrentio, Peerflix, MediaFusion), a URL-encoded magnet
 * (Sootio), or a base64 JSON segment `{"type":"torrent","hash":...}`
 * (AIOStreams' own scrapers: Bitmagnet, Zilean, TorrentGalaxy).
 */
export function aioStreamHash(stream: Record<string, unknown>): string | null {
	if (typeof stream.infoHash === 'string' && isUsableHash(stream.infoHash.toLowerCase())) {
		return stream.infoHash.toLowerCase();
	}
	const url = typeof stream.url === 'string' ? stream.url : '';
	let decoded = url;
	try {
		decoded = decodeURIComponent(url);
	} catch {}
	const magnet = MAGNET_HASH.exec(decoded)?.[1];
	if (magnet) return magnet.toLowerCase();
	for (const segment of url.split(/[/?]/)) {
		if (HASH_SEGMENT.test(segment)) return segment.toLowerCase();
		if (!segment.startsWith('eyJ')) continue;
		try {
			const payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
			const hash = typeof payload?.hash === 'string' ? payload.hash.toLowerCase() : '';
			if (isUsableHash(hash)) return hash;
		} catch {}
	}
	return null;
}

/**
 * Torrents from AIOStreams payloads. `keep` decides for a name-searched
 * source's release; an id-keyed source's are kept as they are. Error rows
 * (`[❌] Knaben`) carry no hash and fall out with the other hashless rows.
 */
export function parseAioStreams(
	payloads: unknown | unknown[],
	keep: (release: ScrapeSearchResult) => boolean
): DebridioScrape {
	const list = Array.isArray(payloads) ? payloads : [payloads];
	const byHash = new Map<string, ScrapeSearchResult>();
	for (const payload of list) {
		const streams = (payload as { streams?: unknown })?.streams;
		if (!Array.isArray(streams)) continue;
		for (const stream of streams as Record<string, unknown>[]) {
			const hash = aioStreamHash(stream);
			if (!hash) continue;
			const source = typeof stream.name === 'string' ? stream.name : '';
			const description = typeof stream.description === 'string' ? stream.description : '';
			const title = description
				.split('\n')
				.map((line) => line.trim())
				.find(Boolean);
			if (!title) continue;
			const hints = stream.behaviorHints as Record<string, unknown> | undefined;
			const bytes = typeof hints?.videoSize === 'number' ? hints.videoSize : 0;
			if (bytes > 0 && bytes < MIN_RELEASE_BYTES) continue;
			// ponytail: videoSize is the played file's size, so a season pack is
			// filed at one episode's size - the same as Torrentio's rows.
			const fileSize = Number((bytes / 1024 / 1024).toFixed(2));
			if (!AIOSTREAMS_ID_SOURCES.has(source) && !keep({ title, fileSize, hash })) continue;
			const existing = byHash.get(hash);
			if (!existing || fileSize > existing.fileSize)
				byHash.set(hash, { title, fileSize, hash });
		}
	}
	return { torrents: [...byHash.values()], available: [] };
}

export function scrapeAioStreamsMovie(
	base: string,
	imdbId: string,
	keep: (release: ScrapeSearchResult) => boolean
): Promise<DebridioScrape> {
	return scrapeStremioMovie(
		base,
		imdbId,
		(payloads) => parseAioStreams(payloads, keep),
		AIOSTREAMS_TIMEOUT_MS
	);
}

export function scrapeAioStreamsSeason(
	base: string,
	imdbId: string,
	season: number,
	episodes: number[],
	keep: (release: ScrapeSearchResult) => boolean
): Promise<DebridioScrape> {
	return scrapeStremioSeason(
		base,
		imdbId,
		season,
		episodes,
		(payloads) => parseAioStreams(payloads, keep),
		AIOSTREAMS_TIMEOUT_MS
	);
}
