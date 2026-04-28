import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { describe, expect, it, vi } from 'vitest';
import { filterLibraryItems } from './libraryFilters';

vi.mock('@/utils/slow', () => ({
	__esModule: true,
	isSlowOrNoLinks: (torrent: UserTorrent) => torrent.id === 'slow',
	isInProgress: (torrent: UserTorrent) => torrent.id === 'progress',
	isFailed: (torrent: UserTorrent) => torrent.id === 'failed',
}));

const baseTorrent: UserTorrent = {
	id: 'base',
	filename: 'base.mkv',
	title: 'Base Title',
	hash: 'hash-base',
	bytes: 100,
	progress: 100,
	status: UserTorrentStatus.finished,
	serviceStatus: 'done',
	added: new Date(),
	mediaType: 'movie',
	links: [],
	selectedFiles: [],
	seeders: 0,
	speed: 0,
};

const createTorrent = (override: Partial<UserTorrent>): UserTorrent => ({
	...baseTorrent,
	...override,
});

describe('filterLibraryItems', () => {
	it('filters slow torrents and sets help text', () => {
		const slowTorrent = createTorrent({ id: 'slow', title: 'Slow', hash: 'h1' });
		const normalTorrent = createTorrent({ id: 'normal', title: 'Normal', hash: 'h2' });
		const { list, helpText } = filterLibraryItems({
			torrents: [slowTorrent, normalTorrent],
			status: 'slow',
		});

		expect(list).toHaveLength(1);
		expect(list[0].id).toBe('slow');
		expect(helpText).toContain('lack any seeders');
	});

	it('filters by media type and updates help text', () => {
		const movieTorrent = createTorrent({ id: 'movie', mediaType: 'movie' });
		const tvTorrent = createTorrent({ id: 'tv', mediaType: 'tv' });
		const { list, helpText } = filterLibraryItems({
			torrents: [movieTorrent, tvTorrent],
			mediaType: 'movie',
		});

		expect(list).toEqual([movieTorrent]);
		expect(helpText).toContain('movies');
	});

	it('honors selected status filter', () => {
		const alpha = createTorrent({ id: 'alpha', title: 'Alpha' });
		const beta = createTorrent({ id: 'beta', title: 'Beta' });
		const { list, helpText } = filterLibraryItems({
			torrents: [alpha, beta],
			status: 'selected',
			selectedTorrents: new Set(['beta']),
		});

		expect(list).toEqual([beta]);
		expect(helpText).toBe('Torrents that you have selected');
	});

	it('matches normalized title filters from router params', () => {
		const target = createTorrent({ id: 'target', title: 'My Movie Title' });
		const other = createTorrent({ id: 'other', title: 'Another Movie' });
		const encodedFilter = encodeURIComponent('mymovietitle');
		const { list } = filterLibraryItems({
			torrents: [target, other],
			titleFilter: encodedFilter,
		});

		expect(list).toEqual([target]);
	});
});
