import fixture from '@/test/fixtures/library/duplicate-films.json';
import type { UserTorrent } from '@/torrent/userTorrent';
import { convertToUserTorrent } from '@/utils/fetchTorrents';
import { filterLibraryItems } from '@/utils/libraryFilters';
import { buildLibraryGrouping, duplicateLibraryTorrents } from '@/utils/libraryGrouping';
import type { LibraryIdentification } from '@/utils/libraryIdentify';
import { describe, expect, it } from 'vitest';

// Every film a real library holds more than once (card 389). Grouping on the
// parsed title alone split 17 of these 54 apart: "Abre los ojos" and "Open Your
// Eyes", a Cyrillic and an English release, "Birds of Prey" with and without
// its subtitle.
describe('same title for films the identifier named', () => {
	const films = fixture.films as Record<
		string,
		{ filename: string; hash: string; identification: LibraryIdentification }[]
	>;
	const torrents: UserTorrent[] = [];
	const identifications: Record<string, LibraryIdentification> = {};
	for (const releases of Object.values(films)) {
		for (const release of releases) {
			const torrent = convertToUserTorrent({
				id: release.hash,
				filename: release.filename,
				hash: release.hash,
				bytes: 1,
				status: 'downloaded',
				added: '2026-10-22T00:00:00.000Z',
				links: [],
			} as any);
			torrents.push(torrent);
			identifications[torrent.id] = release.identification;
		}
	}

	const grouping = buildLibraryGrouping(torrents, identifications);

	it.each(Object.entries(films))('groups every release of %s', (imdbId, releases) => {
		const { list } = filterLibraryItems({ torrents, titleFilter: imdbId, grouping });
		expect(list.map((t) => t.filename).sort()).toEqual(releases.map((r) => r.filename).sort());
	});

	it('keeps the preferred edition without deleting a different known movie', () => {
		const [first, second] = torrents.filter(
			(torrent) => identifications[torrent.id].imdbId === 'tt1798684'
		);
		const small = { ...first, bytes: 1, added: new Date('2010-01-01T00:00:00Z') };
		const large = { ...second, bytes: 3, added: new Date('2012-01-01T00:00:00Z') };
		const middle = {
			...first,
			id: 'tb:identity-copy',
			bytes: 2,
			added: new Date('2011-01-01T00:00:00Z'),
		};
		// Constructed ambiguity control: local parsing gave a different known
		// film the same title. Its authoritative IMDb identity must win.
		const different = {
			...torrents.find((torrent) => identifications[torrent.id].imdbId === 'tt0936501')!,
			title: small.title,
		};
		const candidates = [large, different, middle, small];
		const identities = {
			[small.id]: identifications[small.id],
			[large.id]: identifications[large.id],
			[middle.id]: identifications[small.id],
			[different.id]: identifications[different.id],
		};
		const groups = buildLibraryGrouping(candidates, identities);
		const bySize = duplicateLibraryTorrents(
			candidates,
			groups,
			(retained, candidate) => retained.bytes < candidate.bytes
		);
		const byDate = duplicateLibraryTorrents(
			candidates,
			groups,
			(retained, candidate) => retained.added > candidate.added
		);
		expect(new Set(bySize.map((torrent) => torrent.id))).toEqual(
			new Set([small.id, middle.id])
		);
		expect(new Set(byDate.map((torrent) => torrent.id))).toEqual(
			new Set([large.id, middle.id])
		);
	});
});
