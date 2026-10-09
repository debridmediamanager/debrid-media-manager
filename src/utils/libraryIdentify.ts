import type { UserTorrent } from '@/torrent/userTorrent';

/** A movie content-identifier confidently named from a release filename. */
export interface LibraryIdentification {
	imdbId: string;
	title: string;
	year: number | null;
}

/** Items per request; the route's own ceiling. */
export const IDENTIFY_BATCH = 500;

/** Library items worth asking about: movies with a real release name. */
export function identifiable(torrent: UserTorrent): boolean {
	return (
		torrent.mediaType === 'movie' &&
		Boolean(torrent.filename) &&
		torrent.filename !== torrent.hash &&
		!['Invalid Magnet', 'Magnet', 'noname'].includes(torrent.filename)
	);
}

/**
 * Ask /api/library/identify about `torrents` in batches. Returns the confident
 * matches by library id; a failed batch is skipped, its rows simply stay unnamed.
 */
export async function identifyLibrary(
	torrents: UserTorrent[],
	post: typeof fetch = fetch
): Promise<Record<string, LibraryIdentification>> {
	const found: Record<string, LibraryIdentification> = {};
	for (let at = 0; at < torrents.length; at += IDENTIFY_BATCH) {
		const batch = torrents.slice(at, at + IDENTIFY_BATCH);
		try {
			const response = await post('/api/library/identify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					items: batch.map((t) => ({ filename: t.filename, hash: t.hash || undefined })),
				}),
			});
			if (!response.ok) continue;
			const { results } = (await response.json()) as {
				results: (LibraryIdentification | null)[];
			};
			batch.forEach((t, i) => {
				if (results[i]) found[t.id] = results[i];
			});
		} catch {
			// identification is a nicety; the library works without it
		}
	}
	return found;
}
