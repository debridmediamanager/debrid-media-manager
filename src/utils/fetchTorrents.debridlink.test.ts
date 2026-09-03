import { UserTorrentStatus } from '@/torrent/userTorrent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listAllSeedboxTorrents: vi.fn(),
}));

// The status helpers are the behaviour under test - the `>= 100` threshold is
// the whole point - so the real module is kept and only the network call is
// replaced.
vi.mock('@/services/debridLink', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/debridLink')>()),
	...mocks,
}));
vi.mock('@/services/offcloud', () => ({
	extractBtih: vi.fn(),
	getOffcloudHistory: vi.fn(),
}));
vi.mock('@/services/premiumize', () => ({
	listPremiumizeTransfers: vi.fn(),
	listPremiumizeFolder: vi.fn(),
	listAllPremiumizeItems: vi.fn(),
	resolvePremiumizeTransferHashes: vi.fn(),
}));
vi.mock('@/services/allDebrid', () => ({ getMagnetStatus: vi.fn() }));
vi.mock('@/services/realDebrid', () => ({ getUserTorrentsList: vi.fn() }));
vi.mock('@/services/torbox', () => ({ getTorrentList: vi.fn(), getWebDownloadList: vi.fn() }));

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: { error: (...args: unknown[]) => toastError(...args) },
	toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { convertToDlUserTorrent, fetchDebridLink } from './fetchTorrents';

const HASH = 'DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C';

const seedboxTorrent = (over: Record<string, unknown> = {}) =>
	({
		id: 'seed-1',
		name: 'Big Buck Bunny',
		created: 1_756_800_000,
		hashString: HASH,
		uploadRatio: 0,
		serverId: '',
		wait: false,
		peersConnected: 3,
		status: 100,
		totalSize: 276_134_947,
		downloadPercent: 100,
		downloadSpeed: 0,
		uploadSpeed: 0,
		isZip: false,
		files: [
			{
				id: 'f1',
				name: 'Big Buck Bunny.mp4',
				size: 276_134_947,
				downloadUrl:
					'https://seed41.debrid.link/dl/s37yg6wsgdilpqo80wwssulm-2/Big+Buck+Bunny.mp4',
				downloadPercent: 100,
			},
		],
		error: 0,
		errorString: '',
		...over,
	}) as any;

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('convertToDlUserTorrent', () => {
	it('builds a row addressed by the torrent id', () => {
		const torrent = convertToDlUserTorrent(seedboxTorrent());

		expect(torrent.id).toBe('dl:seed-1');
		expect(torrent.status).toBe(UserTorrentStatus.finished);
		expect(torrent.progress).toBe(100);
		expect(torrent.bytes).toBe(276_134_947);
		expect(torrent.seeders).toBe(3);
		expect(torrent.added.getTime()).toBe(1_756_800_000 * 1000);
	});

	// `hashString` rides on every seedbox row, so a Debrid-Link row is never the
	// hashless kind a Premiumize or an Offcloud row can be.
	it('always carries a lowercased info hash', () => {
		expect(convertToDlUserTorrent(seedboxTorrent()).hash).toBe(HASH.toLowerCase());
	});

	it('falls back to a hash the caller already knows', () => {
		const torrent = convertToDlUserTorrent(seedboxTorrent({ hashString: '' }), HASH);
		expect(torrent.hash).toBe(HASH.toLowerCase());
	});

	// The vendor's own sample carries `status: 6` - VERIFICATION|DOWNLOADING -
	// which equals no single enum member.
	it('reads a combined status flag as downloading, not as unknown', () => {
		const torrent = convertToDlUserTorrent(seedboxTorrent({ status: 6, downloadPercent: 41 }));
		expect(torrent.status).toBe(UserTorrentStatus.downloading);
		expect(torrent.progress).toBe(41);
		expect(torrent.serviceStatus).toBe('6');
	});

	it('finishes above the threshold, not only at it', () => {
		expect(convertToDlUserTorrent(seedboxTorrent({ status: 101 })).status).toBe(
			UserTorrentStatus.finished
		);
	});

	it("surfaces the vendor's own error text as the service status", () => {
		const torrent = convertToDlUserTorrent(
			seedboxTorrent({ status: 4, error: 9, errorString: 'Torrent is dead' })
		);
		expect(torrent.status).toBe(UserTorrentStatus.error);
		expect(torrent.serviceStatus).toBe('Torrent is dead');
	});

	// A Debrid-Link download URL is the whole capability - keyless, IP-agnostic,
	// and it keeps serving after the torrent is deleted - so it must not be
	// written into a row that lives in IndexedDB.
	it('keeps the keyless per-file URLs off the row', () => {
		const torrent = convertToDlUserTorrent(seedboxTorrent());

		expect(torrent.links).toEqual([]);
		expect(torrent.selectedFiles).toEqual([
			{ fileId: 0, filename: 'Big Buck Bunny.mp4', filesize: 276_134_947, link: '' },
		]);
		expect(JSON.stringify(torrent)).not.toContain('debrid.link/dl/');
	});

	// A torrent with many files lists as one ZIP and only expands when fetched by
	// id, which the info modal does on open.
	it('stands a zipped torrent in for its contents', () => {
		const torrent = convertToDlUserTorrent(
			seedboxTorrent({ isZip: true, files: [], name: 'Some.Show.S02' })
		);

		expect(torrent.selectedFiles).toEqual([
			{ fileId: 0, filename: 'Some.Show.S02.zip', filesize: 276_134_947, link: '' },
		]);
	});

	it('detects a series from the file names', () => {
		const torrent = convertToDlUserTorrent(
			seedboxTorrent({
				name: 'Some.Show.Complete.Pack',
				files: [
					{
						id: 'a',
						name: 'Some.Show.S02E01.mkv',
						size: 1,
						downloadUrl: '',
						downloadPercent: 100,
					},
					{
						id: 'b',
						name: 'Some.Show.S02E02.mkv',
						size: 1,
						downloadUrl: '',
						downloadPercent: 100,
					},
				],
			})
		);
		expect(torrent.mediaType).toBe('tv');
	});

	it('calls a release with no playable file other', () => {
		const torrent = convertToDlUserTorrent(
			seedboxTorrent({
				name: 'Some.Software',
				files: [
					{ id: 'a', name: 'setup.exe', size: 1, downloadUrl: '', downloadPercent: 100 },
				],
			})
		);
		expect(torrent.mediaType).toBe('other');
	});

	it('falls back to now when the torrent carries no timestamp', () => {
		const torrent = convertToDlUserTorrent(seedboxTorrent({ created: 0 }));
		expect(Number.isNaN(torrent.added.getTime())).toBe(false);
	});
});

describe('fetchDebridLink', () => {
	it('builds the library from the paged seedbox listing', async () => {
		mocks.listAllSeedboxTorrents.mockResolvedValue([
			seedboxTorrent(),
			seedboxTorrent({ id: 'seed-2', status: 4, downloadPercent: 10 }),
		]);
		const callback = vi.fn();

		await fetchDebridLink('dl-key', callback);

		expect(mocks.listAllSeedboxTorrents).toHaveBeenCalledTimes(1);
		expect(mocks.listAllSeedboxTorrents).toHaveBeenCalledWith('dl-key');
		const [torrents] = callback.mock.calls[0];
		expect(torrents.map((t: { id: string }) => t.id)).toEqual(['dl:seed-1', 'dl:seed-2']);
		expect(torrents[1].status).toBe(UserTorrentStatus.downloading);
	});

	it('honours a custom limit', async () => {
		mocks.listAllSeedboxTorrents.mockResolvedValue([
			seedboxTorrent(),
			seedboxTorrent({ id: 'seed-2' }),
		]);
		const callback = vi.fn();

		await fetchDebridLink('dl-key', callback, 1);

		expect(callback.mock.calls[0][0]).toHaveLength(1);
	});

	it('degrades to an empty library and reports the vendor message', async () => {
		mocks.listAllSeedboxTorrents.mockRejectedValue(new Error('badToken'));
		const callback = vi.fn();

		await fetchDebridLink('dl-key', callback);

		expect(callback).toHaveBeenCalledWith([]);
		expect(toastError).toHaveBeenCalledWith('Debrid-Link error: badToken', expect.any(Object));
	});
});
