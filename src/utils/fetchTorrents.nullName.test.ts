import { describe, expect, it, vi } from 'vitest';
import fixture from '../test/fixtures/torbox-reannounce-finished.json';

vi.mock('@/services/premiumize', () => ({}));
vi.mock('@/services/allDebrid', () => ({ getMagnetStatus: vi.fn() }));
vi.mock('@/services/realDebrid', () => ({ getUserTorrentsList: vi.fn() }));
vi.mock('@/services/torbox', () => ({ getTorrentList: vi.fn(), getWebDownloadList: vi.fn() }));

import {
	convertToAllDebridUserTorrent,
	convertToPremiumizeUserTorrent,
	convertToTbUserTorrent,
} from './fetchTorrents';

// #267 / #541: one nameless entry threw in getMediaId and emptied the whole library.
describe('library converters with a nameless entry', () => {
	it('converts a real TorBox mylist page where one entry has name: null', () => {
		const good = fixture.torrent;
		const nameless = { ...good, id: good.id + 1, hash: 'f'.repeat(40), name: null };

		// The same map UnifiedLibraryFetcher.processTorboxTorrents runs over a page.
		const rows = [good, nameless].map((t) => convertToTbUserTorrent(t as any));

		expect(rows.map((r) => r.title)).toEqual(['Cosmos Laundromat', 'f'.repeat(40)]);
		expect(rows[1].filename).toBe('f'.repeat(40));
	});

	it('survives a TorBox entry with a null download_state', () => {
		const t = { ...fixture.torrent, download_finished: false, download_state: null };
		expect(convertToTbUserTorrent(t as any).id).toBe(`tb:${fixture.torrent.id}`);
	});

	it('converts an AllDebrid magnet with a null filename', () => {
		const row = convertToAllDebridUserTorrent({
			id: 1,
			filename: null,
			hash: 'a'.repeat(40),
			size: 10,
			statusCode: 4,
			uploadDate: 0,
			links: [{ filename: 'movie.mkv', size: 10, link: 'https://x/y' }],
		} as any);
		expect(row.title).toBe('Magnet');
	});

	it('converts a Premiumize source with a null name', () => {
		const row = convertToPremiumizeUserTorrent(
			{
				kind: 'file',
				id: 'x1',
				name: null,
				files: [
					{ id: 'x1', name: 'movie.mkv', size: 10, path: 'movie.mkv', created_at: 1 },
				],
			} as any,
			''
		);
		expect(row.title).toBe('noname');
	});
});
