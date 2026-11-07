// The other postings of a Usenet release, per posting.
//
// One release is often posted more than once: the same name on two indexers, or
// twice on one. When one posting's articles are gone, another usually still has
// them, so nzb2rd is handed the others to fetch in turn. Which postings are copies
// of which is only known at search time, so every fresh search records it here,
// keyed by posting id, and anything holding a release id can read it back: the
// Usenet tab's send, nzb2rd's own fetch of a copy, a Newznab grab.

import { encryptReleaseId } from '@/services/newznab/opaqueId';
import { parseReleaseId, releaseDedupKey, type UsenetResult } from '@/services/nzb2rd';
import { repository as db } from '@/services/repository';

/** How many other postings of one release nzb2rd accepts. */
const MAX_COPIES = 8;

/**
 * For each posting nzb2rd can fetch back (through /api/nzb2rd/download, so an
 * indexer `getIndexers` lists), the other such postings of its release, in the
 * order the rows came, at most MAX_COPIES. Rows are grouped by `releaseDedupKey`.
 * A row the Usenet tab already folded brings its `alternates` along.
 */
export function groupCopies(
	rows: Pick<UsenetResult, 'id' | 'title' | 'alternates'>[]
): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const row of rows) {
		const key = releaseDedupKey(row.title);
		groups.set(key, [...(groups.get(key) ?? []), row.id, ...(row.alternates ?? [])]);
	}
	const copies = new Map<string, string[]>();
	for (const ids of groups.values()) {
		const group = [...new Set(ids)].filter((id) => parseReleaseId(id));
		for (const id of group) {
			const others = group.filter((other) => other !== id).slice(0, MAX_COPIES);
			if (others.length > 0) copies.set(id, others);
		}
	}
	return copies;
}

/** Records the copies among a fresh search's rows. Never fails the search. */
export async function recordCopies(
	rows: Pick<UsenetResult, 'id' | 'title' | 'alternates'>[]
): Promise<void> {
	try {
		await db.recordUsenetCopies(groupCopies(rows));
	} catch (error) {
		console.error('Recording the other postings of Usenet releases failed:', error);
	}
}

/** The other postings of `id` a search recorded in the last week, or none. */
export async function copiesOf(id: string): Promise<string[]> {
	try {
		return (await db.getUsenetCopies(id)) ?? [];
	} catch (error) {
		console.error('Reading the other postings of a Usenet release failed:', error);
		return [];
	}
}

/** What nzb2rd reports for a posting whose articles no news server still has. */
const MISSING_ARTICLES = 'missing from every configured news server';

/** A read of which postings are dead; one that fails knows of none. */
async function deadRead<T>(read: () => Promise<T[]>): Promise<T[]> {
	try {
		return await read();
	} catch (error) {
		console.error('Reading which Usenet postings are dead failed:', error);
		return [];
	}
}

/**
 * `id` and its copies in the order to try them: postings known dead go last, the
 * rest keep their order. Dead is an earlier nzb2rd job of DMM's that found the
 * articles gone, or a report through /api/usenet/dead from nzb2rd or a sponsor's
 * zurg. The first is the one to fetch (`id` itself unless it is known dead and a
 * copy is not), the others are what nzb2rd falls back to.
 */
export async function orderCopies(id: string): Promise<{ id: string; alternates: string[] }> {
	const postings = [id, ...(await copiesOf(id))];
	if (postings.length === 1) return { id, alternates: [] };
	const [markers, reported] = await Promise.all([
		deadRead(() => db.getNzb2rdTransfers(postings)),
		deadRead(() => db.getUsenetDead(postings)),
	]);
	const dead = new Set([
		...markers
			.filter((m) => m.status === 'failed' && m.error?.includes(MISSING_ARTICLES))
			.map((m) => m.releaseId.toLowerCase()),
		...reported,
	]);
	const isDead = (posting: string) => dead.has(posting.toLowerCase());
	const [first, ...alternates] = [
		...postings.filter((posting) => !isDead(posting)),
		...postings.filter(isDead),
	];
	return { id: first, alternates };
}

/**
 * Postings as Newznab grab tokens, for an NZB an *arr fetched: its download client
 * may be the user's own SABnzbd, and a qualified id names an upstream DMM uses.
 * /api/nzb2rd/download takes a token as its `id`.
 */
export function asTokens(ids: string[]): string[] {
	return ids.map((id) =>
		encryptReleaseId(id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1))
	);
}
