import type { UserTorrent } from '@/torrent/userTorrent';
import { normalize } from '@/utils/mediaId';

/** A movie or show content-identifier confidently named from a release filename. */
export interface LibraryIdentification {
	imdbId: string;
	title: string;
	year: number | null;
	/** What the identifier found the release to be, whatever the library guessed. */
	kind: 'movie' | 'tv';
}

/** Items per request; the route's own ceiling. */
export const IDENTIFY_BATCH = 500;
/** Refusals per batch before it is given up; the route allows ten batches a minute. */
const MAX_REFUSALS = 5;

/** Library items worth asking about: movies and shows with a real release name. */
export function identifiable(torrent: UserTorrent): boolean {
	return (
		(torrent.mediaType === 'movie' || torrent.mediaType === 'tv') &&
		Boolean(torrent.filename) &&
		torrent.filename !== torrent.hash &&
		!['Invalid Magnet', 'Magnet', 'noname'].includes(torrent.filename)
	);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask /api/library/identify about `torrents` in batches, handing each batch's
 * confident matches (by library id) to `onFound` as it lands. A batch the rate
 * limit refuses waits out its Retry-After and is asked again, so a library past
 * ten batches is named in full rather than cut off; any other failure skips the
 * batch and its rows simply stay unnamed.
 */
export async function identifyLibrary(
	torrents: UserTorrent[],
	onFound: (found: Record<string, LibraryIdentification>) => void,
	post: typeof fetch = fetch,
	wait: (ms: number) => Promise<unknown> = sleep
): Promise<void> {
	for (let at = 0; at < torrents.length; at += IDENTIFY_BATCH) {
		const batch = torrents.slice(at, at + IDENTIFY_BATCH);
		for (let refusals = 0; refusals < MAX_REFUSALS; refusals++) {
			try {
				const response = await post('/api/library/identify', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						items: batch.map((t) => ({
							filename: t.filename,
							hash: t.hash || undefined,
						})),
					}),
				});
				if (response.status === 429) {
					const seconds = Number(response.headers.get('retry-after')) || 10;
					await wait(Math.min(seconds, 60) * 1000);
					continue;
				}
				if (!response.ok) break;
				const { results } = (await response.json()) as {
					results: (LibraryIdentification | null)[];
				};
				const found: Record<string, LibraryIdentification> = {};
				batch.forEach((t, i) => {
					if (results[i]) found[t.id] = results[i];
				});
				if (Object.keys(found).length) onFound(found);
			} catch {
				// identification is a nicety; the library works without it
			}
			break;
		}
	}
}

/**
 * What "same title" groups a library row by. A movie the identifier named goes
 * by its IMDb id, so "Abre los ojos" and "Open Your Eyes", or a Cyrillic and an
 * English release of one film, count as duplicates; the parsed title alone
 * split 17 of 54 doubled films in a real library apart (card 389). Shows keep
 * the parsed title, which carries the season and episode.
 */
export function sameTitleKey(torrent: UserTorrent, identification?: LibraryIdentification): string {
	return identification?.kind === 'movie' && torrent.mediaType === 'movie'
		? identification.imdbId
		: normalize(torrent.title);
}
