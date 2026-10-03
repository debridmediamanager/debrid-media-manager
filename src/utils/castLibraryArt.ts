import type { HashIdentity } from '@/services/database/hashImdb';
import { repository as db } from '@/services/repository';

/**
 * Cover art and identification for one DMM Cast library entry.
 *
 * A library catalog lists releases, not titles, so `name` stays the release
 * name - a library can hold five releases of one film and they must still read
 * apart. What DMM matched the release to goes in the fields Stremio shows next
 * to it: the poster and background on the tile and the detail page, the title
 * as the description, the year as the release info. The images come from
 * metahub, the same host the casted catalogs and Cinemeta already use.
 */
export function libraryArt({ imdbId, title, year }: HashIdentity) {
	return {
		poster: `https://images.metahub.space/poster/small/${imdbId}/img`,
		background: `https://images.metahub.space/background/medium/${imdbId}/img`,
		...(title ? { description: title } : {}),
		...(year ? { releaseInfo: String(year) } : {}),
	};
}

/**
 * What DMM knows each hash to be, keyed by lowercase hash.
 *
 * Best effort on purpose: the art is decoration, so a database that cannot be
 * read costs the covers and never the listing.
 */
export async function identifyLibraryHashes(
	hashes: Array<string | null | undefined>
): Promise<Map<string, HashIdentity>> {
	const known = hashes.filter((hash): hash is string => typeof hash === 'string' && hash !== '');
	if (known.length === 0) return new Map();
	try {
		return await db.identifyLibraryHashes(known);
	} catch (error) {
		console.error(
			'[Cast Library] identification unavailable:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return new Map();
	}
}

/**
 * Library metas, in the order given, with art on every entry DMM can identify.
 * Entries without a torrent hash - web downloads, usenet jobs, saved hoster
 * links - pass through as they are.
 */
export async function withLibraryArt<T extends object>(
	entries: Array<{ meta: T; hash?: string | null }>
): Promise<T[]> {
	const identities = await identifyLibraryHashes(entries.map((entry) => entry.hash));
	return entries.map(({ meta, hash }) => {
		const identity = hash ? identities.get(hash.toLowerCase()) : undefined;
		return identity ? { ...meta, ...libraryArt(identity) } : meta;
	});
}

/** The same art for the meta of one opened library entry, or nothing. */
export async function libraryArtFor(hash: string | null | undefined) {
	const identity = hash ? (await identifyLibraryHashes([hash])).get(hash.toLowerCase()) : null;
	return identity ? libraryArt(identity) : {};
}
