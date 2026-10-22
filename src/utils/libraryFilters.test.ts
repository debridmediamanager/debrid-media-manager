import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { describe, expect, it, vi } from 'vitest';
import {
	filterLibraryItems as filterGroupedLibraryItems,
	type LibraryFilterOptions,
} from './libraryFilters';
import { buildLibraryGrouping } from './libraryGrouping';

const filterLibraryItems = (options: Omit<LibraryFilterOptions, 'grouping'>) =>
	filterGroupedLibraryItems({
		...options,
		grouping: buildLibraryGrouping(options.torrents),
	});

vi.mock('@/utils/slow', () => ({
	__esModule: true,
	isSlowOrNoLinks: (torrent: UserTorrent) => torrent.id === 'slow',
	isInProgress: (torrent: UserTorrent) => torrent.id === 'progress',
	isFailed: (torrent: UserTorrent) => torrent.id === 'failed',
	isUncached: (torrent: UserTorrent) => torrent.id === 'uncached',
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
	it('filters slow torrents', () => {
		const slowTorrent = createTorrent({ id: 'slow', title: 'Slow', hash: 'h1' });
		const normalTorrent = createTorrent({ id: 'normal', title: 'Normal', hash: 'h2' });
		const { list } = filterLibraryItems({
			torrents: [slowTorrent, normalTorrent],
			status: 'slow',
		});

		expect(list).toHaveLength(1);
		expect(list[0].id).toBe('slow');
	});

	it('filters by media type', () => {
		const movieTorrent = createTorrent({ id: 'movie', mediaType: 'movie' });
		const tvTorrent = createTorrent({ id: 'tv', mediaType: 'tv' });
		const { list } = filterLibraryItems({
			torrents: [movieTorrent, tvTorrent],
			mediaType: 'movie',
		});

		expect(list).toEqual([movieTorrent]);
	});

	it('honors selected status filter', () => {
		const alpha = createTorrent({ id: 'alpha', title: 'Alpha' });
		const beta = createTorrent({ id: 'beta', title: 'Beta' });
		const { list } = filterLibraryItems({
			torrents: [alpha, beta],
			status: 'selected',
			selectedTorrents: new Set(['beta']),
		});

		expect(list).toEqual([beta]);
	});

	it('honors the uncached status filter', () => {
		const dropped = createTorrent({ id: 'uncached', title: 'Dropped' });
		const healthy = createTorrent({ id: 'healthy', title: 'Healthy' });
		const { list } = filterLibraryItems({
			torrents: [dropped, healthy],
			status: 'uncached',
		});

		expect(list).toEqual([dropped]);
	});

	it('filters by the Offcloud service tab', () => {
		const offcloud = createTorrent({ id: 'oc:req-1', title: 'Cloud item', hash: 'h1' });
		const premiumize = createTorrent({ id: 'pm:t1', title: 'Transfer', hash: 'h2' });
		const { list } = filterLibraryItems({
			torrents: [offcloud, premiumize],
			service: 'oc',
		});

		expect(list).toEqual([offcloud]);
	});

	it('filters by the Debrid-Link service tab', () => {
		const debridLink = createTorrent({ id: 'dl:seed-1', title: 'Seedbox item', hash: 'h1' });
		const offcloud = createTorrent({ id: 'oc:req-1', title: 'Cloud item', hash: 'h2' });
		const { list } = filterLibraryItems({
			torrents: [debridLink, offcloud],
			service: 'dl',
		});

		expect(list).toEqual([debridLink]);
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
