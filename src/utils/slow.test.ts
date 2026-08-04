import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFailed, isInProgress, isSlowOrNoLinks, isUncached } from './slow';

describe('slow', () => {
	let originalDateNow: () => number;

	beforeEach(() => {
		originalDateNow = Date.now;
	});

	afterEach(() => {
		Date.now = originalDateNow;
	});

	describe('isSlowOrNoLinks', () => {
		it('returns true for old downloading torrents with no seeders', () => {
			const now = new Date('2024-01-01T12:00:00');
			Date.now = vi.fn(() => now.getTime());

			const torrent = {
				id: '1',
				filename: 'test.mkv',
				title: 'test',
				hash: 'abc123',
				bytes: 1000000,
				progress: 50,
				status: UserTorrentStatus.downloading,
				serviceStatus: 'downloading',
				added: new Date('2024-01-01T11:30:00'),
				mediaType: 'other' as const,
				links: [],
				selectedFiles: [],
				seeders: 0,
				speed: 0,
			};

			expect(isSlowOrNoLinks(torrent)).toBe(true);
		});

		it('returns false for recent downloading torrents with no seeders', () => {
			const now = new Date('2024-01-01T12:00:00');
			Date.now = vi.fn(() => now.getTime());

			const torrent = {
				id: '1',
				filename: 'test.mkv',
				title: 'test',
				hash: 'abc123',
				bytes: 1000000,
				progress: 50,
				status: UserTorrentStatus.downloading,
				serviceStatus: 'downloading',
				added: new Date('2024-01-01T11:41:00'), // 19 minutes ago, less than 20 minutes
				mediaType: 'other' as const,
				links: [],
				selectedFiles: [],
				seeders: 0,
				speed: 0,
			};

			expect(isSlowOrNoLinks(torrent)).toBe(false);
		});

		it('returns false for old downloading torrents with seeders', () => {
			const now = new Date('2024-01-01T12:00:00');
			Date.now = vi.fn(() => now.getTime());

			const torrent = {
				id: '1',
				filename: 'test.mkv',
				title: 'test',
				hash: 'abc123',
				bytes: 1000000,
				progress: 50,
				status: UserTorrentStatus.downloading,
				serviceStatus: 'downloading',
				added: new Date('2024-01-01T11:30:00'),
				mediaType: 'other' as const,
				links: [],
				selectedFiles: [],
				seeders: 5,
				speed: 0,
			};

			expect(isSlowOrNoLinks(torrent)).toBe(false);
		});

		it('returns false for old completed torrents with no seeders', () => {
			const now = new Date('2024-01-01T12:00:00');
			Date.now = vi.fn(() => now.getTime());

			const torrent = {
				id: '1',
				filename: 'test.mkv',
				title: 'test',
				hash: 'abc123',
				bytes: 1000000,
				progress: 100,
				status: UserTorrentStatus.finished,
				serviceStatus: 'finished',
				added: new Date('2024-01-01T11:30:00'),
				mediaType: 'other' as const,
				links: [],
				selectedFiles: [],
				seeders: 0,
				speed: 0,
			};

			expect(isSlowOrNoLinks(torrent)).toBe(false);
		});

		it('returns true for exactly 20 minute old downloading torrents with no seeders', () => {
			const now = new Date('2024-01-01T12:20:00');
			Date.now = vi.fn(() => now.getTime());

			const torrent = {
				id: '1',
				filename: 'test.mkv',
				title: 'test',
				hash: 'abc123',
				bytes: 1000000,
				progress: 50,
				status: UserTorrentStatus.downloading,
				serviceStatus: 'downloading',
				added: new Date('2024-01-01T12:00:00'),
				mediaType: 'other' as const,
				links: [],
				selectedFiles: [],
				seeders: 0,
				speed: 0,
			};

			expect(isSlowOrNoLinks(torrent)).toBe(true);
		});
	});

	describe('isInProgress', () => {
		it('returns true for downloading status', () => {
			const torrent = {
				status: UserTorrentStatus.downloading,
			} as UserTorrent;

			expect(isInProgress(torrent)).toBe(true);
		});

		it('returns true for waiting status', () => {
			const torrent = {
				status: UserTorrentStatus.waiting,
			} as UserTorrent;

			expect(isInProgress(torrent)).toBe(true);
		});

		it('returns false for finished status', () => {
			const torrent = {
				status: UserTorrentStatus.finished,
			} as UserTorrent;

			expect(isInProgress(torrent)).toBe(false);
		});

		it('returns false for error status', () => {
			const torrent = {
				status: UserTorrentStatus.error,
			} as UserTorrent;

			expect(isInProgress(torrent)).toBe(false);
		});
	});

	describe('isFailed', () => {
		it('returns true for error status', () => {
			const torrent = {
				status: UserTorrentStatus.error,
			} as UserTorrent;

			expect(isFailed(torrent)).toBe(true);
		});

		it('returns false for downloading status', () => {
			const torrent = {
				status: UserTorrentStatus.downloading,
			} as UserTorrent;

			expect(isFailed(torrent)).toBe(false);
		});

		it('returns false for finished status', () => {
			const torrent = {
				status: UserTorrentStatus.finished,
			} as UserTorrent;

			expect(isFailed(torrent)).toBe(false);
		});

		it('returns false for waiting status', () => {
			const torrent = {
				status: UserTorrentStatus.waiting,
			} as UserTorrent;

			expect(isFailed(torrent)).toBe(false);
		});
	});
});

describe('isUncached', () => {
	const rd = (over: Partial<UserTorrent>) =>
		({
			id: 'rd:1',
			status: UserTorrentStatus.finished,
			links: ['https://real-debrid.com/d/ABC'],
			...over,
		}) as UserTorrent;

	it('flags a finished RD torrent whose links RD has dropped', () => {
		expect(isUncached(rd({ links: [] }))).toBe(true);
	});

	it('leaves a finished RD torrent with links alone', () => {
		expect(isUncached(rd({}))).toBe(false);
	});

	it('does not flag an RD torrent that is still downloading', () => {
		expect(isUncached(rd({ status: UserTorrentStatus.downloading, links: [] }))).toBe(false);
	});

	it('tolerates an RD torrent with no links array at all', () => {
		expect(isUncached({ id: 'rd:2', status: UserTorrentStatus.finished } as UserTorrent)).toBe(
			true
		);
	});

	it('flags AllDebrid magnet status 11', () => {
		expect(
			isUncached({ id: 'ad:1', serviceStatus: '11', links: [] } as unknown as UserTorrent)
		).toBe(true);
		expect(
			isUncached({ id: 'ad:2', serviceStatus: '4', links: [] } as unknown as UserTorrent)
		).toBe(false);
	});

	it('never flags TorBox, which reports no equivalent', () => {
		expect(
			isUncached({
				id: 'tb:1',
				status: UserTorrentStatus.finished,
				links: [],
			} as unknown as UserTorrent)
		).toBe(false);
	});
});
