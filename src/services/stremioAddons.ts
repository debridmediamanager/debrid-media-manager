import { DebridioScrape, parseStreams, scrapeStremioMovie, scrapeStremioSeason } from './debridio';
import { isUsableHash } from './mediasearch';

/**
 * Torrentio and Peerflix as torrent and availability sources for a page the
 * library has nothing on. Neither is given a key: their `realdebrid=` path with
 * a placeholder still marks which torrents Real-Debrid holds (`[RD+]`, against
 * `[RD download]`), as the search page's External Sources do. An addon that
 * needs a real debrid key - Comet, TorrentsDB - is left out on purpose: it can
 * use the key from its own servers, a second IP on the account.
 *
 * Wire format, measured 2026-10-29: `title` line 1 is the torrent's name and
 * carries `💾 N GB` (one file's size, so a season pack shows one episode);
 * the hash is the 40 hex digits in the `url` path.
 */
export const STREMIO_ADDONS = {
	torrentio: 'https://torrentio.strem.fun/realdebrid=real-debrid-key',
	peerflix: 'https://addon.peerflix.mov/realdebrid=real-debrid-key',
} as const;

export type StremioAddon = keyof typeof STREMIO_ADDONS;

export const STREMIO_ADDON_NAMES = Object.keys(STREMIO_ADDONS) as StremioAddon[];

const HASH_IN_PATH = /\/([0-9a-f]{40})(?:\/|$)/i;

export function parseAddonStreams(payloads: unknown | unknown[]): DebridioScrape {
	return parseStreams(payloads, {
		hashOf: (s) => {
			const hash = (
				typeof s.infoHash === 'string'
					? s.infoHash
					: (HASH_IN_PATH.exec(typeof s.url === 'string' ? s.url : '')?.[1] ?? '')
			).toLowerCase();
			return isUsableHash(hash) ? hash : null;
		},
		cachedOf: (s) => typeof s.name === 'string' && s.name.startsWith('[RD+]'),
	});
}

export function scrapeAddonMovie(imdbId: string, addon: StremioAddon): Promise<DebridioScrape> {
	return scrapeStremioMovie(STREMIO_ADDONS[addon], imdbId, parseAddonStreams);
}

export function scrapeAddonSeason(
	imdbId: string,
	season: number,
	episodes: number[],
	addon: StremioAddon
): Promise<DebridioScrape> {
	return scrapeStremioSeason(STREMIO_ADDONS[addon], imdbId, season, episodes, parseAddonStreams);
}
