// The other postings of a Usenet release, per posting.
//
// One release is often posted more than once: the same name on two indexers, or
// twice on one. When one posting's articles are gone, another usually still has
// them, so nzb2rd is handed the others to fetch in turn. Which postings are copies
// of which is only known at search time, so every fresh search records it here,
// keyed by posting id, and anything holding a release id can read it back: the
// Usenet tab's send, nzb2rd's own fetch of a copy, a Newznab grab.

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
