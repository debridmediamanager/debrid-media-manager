import {
	EASYNEWS_NZB_PREFIX,
	fetchEasynewsNzb,
	splitEasynewsPath,
	type EasynewsCredentials,
} from '@/services/easynews';
import { isStoreConfigured, putStoredNzb } from '@/services/newznab/store';
import { repository as db } from '@/services/repository';
import { isNzbBlocked } from '@/services/takedown/blocklist';
import { sanitizeNzbAsync } from '@/utils/nzbSanitize';

// Easynews NZBs visitors fetch by clicking a row (Send to zurg, Download NZB, Watch) are
// kept: anonymized, stored under `en:<hash>` and listed with the title's Usenet
// results, as an indexer's would be. Nothing is fetched that a visitor did not click.

const EPISODE = /S(\d+)E(\d+)/i;

export interface EasynewsNzbTarget {
	imdbId: string;
	kind: 'movie' | 'show';
	size?: unknown;
}

/** The season a release files under on its show page; null for a show file naming no episode. */
export function listedSeason(kind: 'movie' | 'show', release: string): number | undefined | null {
	if (kind === 'movie') return undefined;
	const episode = EPISODE.exec(release);
	return episode ? Number(episode[1]) : null;
}

export type SaveOutcome = 'saved' | 'blocked' | 'unstored';

/**
 * Fetches one result's NZB with the caller's own login, rebuilds it without anything
 * that could name the download (utils/nzbSanitize), stores it and lists it. Throws
 * what fetchEasynewsNzb and sanitizeNzbAsync throw; neither message carries the login.
 */
export async function saveEasynewsNzb(
	credentials: EasynewsCredentials,
	path: string,
	sig: string,
	target: EasynewsNzbTarget
): Promise<SaveOutcome> {
	const cleaned = await fetchCleanEasynewsNzb(credentials, path, sig);
	if (!cleaned) return 'blocked';
	return storeEasynewsNzb(path, cleaned.xml, target);
}

/**
 * One result's NZB, rebuilt without anything that could name the download, or null
 * when a takedown blocks it. Throws what fetchEasynewsNzb and sanitizeNzbAsync throw.
 */
export async function fetchCleanEasynewsNzb(
	credentials: EasynewsCredentials,
	path: string,
	sig: string
): Promise<Awaited<ReturnType<typeof sanitizeNzbAsync>> | null> {
	const cleaned = await sanitizeNzbAsync(await fetchEasynewsNzb(credentials, path, sig));
	// By the name the search lists it under, as withoutBlockedReleases judges it.
	return (await isNzbBlocked(cleaned.xml, splitEasynewsPath(path).name)) ? null : cleaned;
}

/** Stores an already cleaned NZB under `en:<hash>` and lists it with the title's Usenet results. */
export async function storeEasynewsNzb(
	path: string,
	xml: string,
	target: EasynewsNzbTarget
): Promise<Exclude<SaveOutcome, 'blocked'>> {
	const { hash, name } = splitEasynewsPath(path);
	const season = listedSeason(target.kind, path.slice(path.indexOf('/') + 1));
	try {
		await putStoredNzb(EASYNEWS_NZB_PREFIX, hash, xml);
	} catch (error) {
		console.error('Easynews NZB store write failed:', error);
		return 'unstored';
	}
	if (season !== null) {
		await db.addEasynewsNzb(target.imdbId, season, {
			id: `${EASYNEWS_NZB_PREFIX}:${hash}`,
			title: name,
			size:
				Number.isSafeInteger(target.size) && (target.size as number) > 0
					? (target.size as number)
					: 0,
		});
	}
	return 'saved';
}

const saving = new Set<string>();

/**
 * For Watch: saves a release once, after the click has its link, and
 * never fails the click. A release already listed is not fetched again.
 */
export function saveEasynewsNzbInBackground(
	credentials: EasynewsCredentials,
	path: string,
	sig: string,
	target: EasynewsNzbTarget
): Promise<void> {
	const { hash } = splitEasynewsPath(path);
	const season = listedSeason(target.kind, path.slice(path.indexOf('/') + 1));
	if (season === null || saving.has(hash) || !isStoreConfigured()) return Promise.resolve();
	saving.add(hash);
	return (async () => {
		const listed = await db.getEasynewsNzbs(target.imdbId, season);
		if (listed.some((r) => r.id === `${EASYNEWS_NZB_PREFIX}:${hash}`)) return;
		await saveEasynewsNzb(credentials, path, sig, target);
	})()
		.catch((error) =>
			console.error(
				'Easynews NZB save failed:',
				error instanceof Error ? error.message : error
			)
		)
		.finally(() => saving.delete(hash));
}
