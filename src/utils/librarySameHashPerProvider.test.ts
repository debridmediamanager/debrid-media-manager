import fixture from '@/test/fixtures/library/same-hash-rd-and-pm-2026-11-04.json';
import type { UserTorrent } from '@/torrent/userTorrent';
import {
	buildPremiumizeRowSources,
	convertToPremiumizeUserTorrent,
	convertToUserTorrent,
} from '@/utils/fetchTorrents';
import { filterLibraryItems } from '@/utils/libraryFilters';
import { buildLibraryGrouping, sameHashMergeGroups } from '@/utils/libraryGrouping';
import { describe, expect, it } from 'vitest';

// Card 561: one release kept on Real-Debrid and on Premiumize is two deliberate
// copies, not a duplicate. "Same hash" and "Merge same hash" must stay inside
// one provider, or the merge deletes the other provider's copy.
const rdRow = convertToUserTorrent(fixture.realdebrid.torrents[0] as any);
const pm = fixture.premiumize;
const pmRow = buildPremiumizeRowSources(
	pm.transfers as any,
	pm.rootContent as any,
	pm.items as any
).map((source) => convertToPremiumizeUserTorrent(source, (pm.hashes as any)[source.id] ?? ''))[0];
const secondRdRow: UserTorrent = { ...rdRow, id: 'rd:SECONDCOPY' };

describe('same hash is per provider', () => {
	it('captured rows are one hash on two providers', () => {
		expect(rdRow.id.startsWith('rd:')).toBe(true);
		expect(pmRow.id.startsWith('pm:')).toBe(true);
		expect(pmRow.hash).toBe(rdRow.hash);
		expect(rdRow.status).toBe(pmRow.status);
	});

	it('an RD copy and a PM copy are not same-hash duplicates', () => {
		const torrents = [rdRow, pmRow];
		const grouping = buildLibraryGrouping(torrents);
		expect(grouping.duplicateHashes).toBe(0);
		expect(filterLibraryItems({ torrents, status: 'samehash', grouping }).list).toEqual([]);
		// Each provider stores its own copy.
		expect(grouping.totalBytes).toBe(rdRow.bytes + pmRow.bytes);
		expect(sameHashMergeGroups(torrents).size).toBe(0);
	});

	it('two RD copies still count and merge, without the PM copy', () => {
		const torrents = [rdRow, pmRow, secondRdRow];
		const grouping = buildLibraryGrouping(torrents);
		expect(grouping.duplicateHashes).toBe(1);
		const { list } = filterLibraryItems({ torrents, status: 'samehash', grouping });
		expect(list.map((t) => t.id).sort()).toEqual([rdRow.id, secondRdRow.id].sort());
		const groups = [...sameHashMergeGroups(torrents).values()];
		expect(groups.map((g) => g.map((t) => t.id))).toEqual([[rdRow.id, secondRdRow.id]]);
	});
});
