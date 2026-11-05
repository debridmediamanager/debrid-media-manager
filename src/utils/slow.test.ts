import rarBundle from '@/test/fixtures/realdebrid/rd-rar-bundle-torrent-info.json';
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
		it('ages the recorded RD added clock from the real torrent-info response', () => {
			Date.now = vi.fn(() => Date.parse('2026-11-05T00:50:23Z'));
			const torrent = {
				id: `rd:${rarBundle.body.id}`,
				status: UserTorrentStatus.downloading,
				added: new Date(rarBundle.body.added),
				seeders: 0,
			} as UserTorrent;
			expect(isSlowOrNoLinks(torrent)).toBe(true);
		});

		it.each([
			['winter CET', '2026-01-15T11:20:00Z', '2026-01-15T12:00:00Z', true],
			['summer CEST', '2026-07-15T10:20:00Z', '2026-07-15T12:00:00Z', true],
			['recent winter CET', '2026-01-15T11:19:59Z', '2026-01-15T12:00:00Z', false],
			['recent summer CEST', '2026-07-15T10:19:59Z', '2026-07-15T12:00:00Z', false],
			['spring DST change', '2026-03-29T01:20:00Z', '2026-03-29T01:00:00Z', true],
			['autumn DST change', '2026-10-25T02:20:00Z', '2026-10-25T03:00:00Z', true],
		])('uses Paris wall time for RD added timestamps: %s', (_label, now, added, expected) => {
			Date.now = vi.fn(() => Date.parse(now));
			const torrent = {
				id: 'rd:synthetic',
				status: UserTorrentStatus.downloading,
				added: new Date(added),
				seeders: 0,
			} as UserTorrent;

			expect(isSlowOrNoLinks(torrent)).toBe(expected);
		});

		it('keeps other providers added timestamps as real instants', () => {
			Date.now = vi.fn(() => Date.parse('2026-07-15T12:19:59Z'));
			const torrent = {
				id: 'tb:77',
				status: UserTorrentStatus.downloading,
				added: new Date('2026-07-15T12:00:00Z'),
				seeders: 0,
			} as UserTorrent;

			expect(isSlowOrNoLinks(torrent)).toBe(false);
		});

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

		it('never flags a TorBox web download, which has no swarm to seed it', () => {
			const now = new Date('2024-01-01T12:00:00');
			Date.now = vi.fn(() => now.getTime());

			const webDownload = {
				id: 'tb:w77',
				filename: 'test.mkv',
				title: 'test',
				hash: 'd41d8cd98f00b204e9800998ecf8427e',
				bytes: 1000000,
				progress: 50,
				status: UserTorrentStatus.downloading,
				serviceStatus: 'downloading',
				added: new Date('2024-01-01T11:30:00'), // old enough to trip the check
				mediaType: 'other' as const,
				links: [],
				selectedFiles: [],
				seeders: 0,
				speed: 0,
			};

			expect(isSlowOrNoLinks(webDownload)).toBe(false);
			// the same row as a torrent still counts as slow
			expect(isSlowOrNoLinks({ ...webDownload, id: 'tb:77' })).toBe(true);
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
