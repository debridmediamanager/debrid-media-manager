import fixture from '@/test/fixtures/library/duplicate-films.json';
import type { UserTorrent } from '@/torrent/userTorrent';
import { convertToUserTorrent } from '@/utils/fetchTorrents';
import { filterLibraryItems } from '@/utils/libraryFilters';
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

	it.each(Object.entries(films))('groups every release of %s', (imdbId, releases) => {
		const { list } = filterLibraryItems({ torrents, titleFilter: imdbId, identifications });
		expect(list.map((t) => t.filename).sort()).toEqual(releases.map((r) => r.filename).sort());
	});
});
