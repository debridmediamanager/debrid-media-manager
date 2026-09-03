import { UserTorrentStatus } from '@/torrent/userTorrent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getOffcloudHistory: vi.fn(),
}));

// `extractBtih` is the real one: recovering a hash from Offcloud's rewritten
// `originalLink` is the behaviour under test, not a collaborator to stub out.
vi.mock('@/services/offcloud', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/offcloud')>()),
	...mocks,
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

import { convertToOffcloudUserTorrent, fetchOffcloud } from './fetchTorrents';

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

const historyItem = (over: Record<string, unknown> = {}) => ({
	requestId: '68b7f0c1e4b0a1',
	fileName: 'Big Buck Bunny',
	status: 'downloaded',
	originalLink: `magnet:?xt=urn:btih:${HASH}&dn=Big+Buck+Bunny`,
	createdOn: '2026-09-02T10:11:12.000Z',
	...over,
});

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('convertToOffcloudUserTorrent', () => {
	it('builds a row addressed by the request id', () => {
		const torrent = convertToOffcloudUserTorrent(historyItem());

		expect(torrent.id).toBe('oc:68b7f0c1e4b0a1');
		expect(torrent.hash).toBe(HASH);
		expect(torrent.status).toBe(UserTorrentStatus.finished);
		expect(torrent.progress).toBe(100);
		expect(torrent.serviceStatus).toBe('downloaded');
		expect(torrent.added.toISOString()).toBe('2026-09-02T10:11:12.000Z');
	});

	// `cloud/history` reports no sizes at all, and there is no bulk endpoint that
	// does - the modal fills one row in on demand instead.
	it('starts every row at zero bytes with no files', () => {
		const torrent = convertToOffcloudUserTorrent(historyItem());
		expect(torrent.bytes).toBe(0);
		expect(torrent.selectedFiles).toEqual([]);
		expect(torrent.links).toEqual([]);
	});

	// Offcloud rewrites a torrent-URL submission's originalLink to
	// `<hash>.torrent`, which is the only hash such a row will ever carry.
	it('recovers the hash from a torrent-file submission', () => {
		const torrent = convertToOffcloudUserTorrent(
			historyItem({ originalLink: `${HASH.toUpperCase()}.torrent` })
		);
		expect(torrent.hash).toBe(HASH);
	});

	// Offcloud is a remote-download service too: a plain HTTP submission has no
	// info hash anywhere, which is normal rather than a failure.
	it('leaves a plain HTTP row without a hash', () => {
		const torrent = convertToOffcloudUserTorrent(
			historyItem({ originalLink: 'https://example.com/video.mkv', fileName: 'video.mkv' })
		);
		expect(torrent.hash).toBe('');
	});

	it('prefers a hash the caller already knows over the rewritten link', () => {
		const torrent = convertToOffcloudUserTorrent(
			historyItem({ originalLink: 'https://example.com/video.mkv' }),
			HASH.toUpperCase()
		);
		expect(torrent.hash).toBe(HASH);
	});

	it('detects a series from the name', () => {
		const torrent = convertToOffcloudUserTorrent(
			historyItem({ fileName: 'Some.Show.S02E03.1080p' })
		);
		expect(torrent.mediaType).toBe('tv');
	});

	it('falls back to now when Offcloud stamps no date', () => {
		const torrent = convertToOffcloudUserTorrent(historyItem({ createdOn: undefined }));
		expect(Number.isNaN(torrent.added.getTime())).toBe(false);
	});
});

describe('fetchOffcloud', () => {
	it('builds the whole library from one history call', async () => {
		mocks.getOffcloudHistory.mockResolvedValue([
			historyItem(),
			historyItem({ requestId: 'second', status: 'created' }),
		]);
		const callback = vi.fn();

		await fetchOffcloud('oc-key', callback);

		expect(mocks.getOffcloudHistory).toHaveBeenCalledTimes(1);
		const [torrents] = callback.mock.calls[0];
		expect(torrents.map((t: { id: string }) => t.id)).toEqual([
			'oc:68b7f0c1e4b0a1',
			'oc:second',
		]);
		expect(torrents[1].status).toBe(UserTorrentStatus.waiting);
	});

	it('honours a custom limit', async () => {
		mocks.getOffcloudHistory.mockResolvedValue([
			historyItem(),
			historyItem({ requestId: 'second' }),
		]);
		const callback = vi.fn();

		await fetchOffcloud('oc-key', callback, 1);

		expect(callback.mock.calls[0][0]).toHaveLength(1);
	});

	it('degrades to an empty library and reports the vendor message', async () => {
		mocks.getOffcloudHistory.mockRejectedValue(new Error('NOAUTH'));
		const callback = vi.fn();

		await fetchOffcloud('oc-key', callback);

		expect(callback).toHaveBeenCalledWith([]);
		expect(toastError).toHaveBeenCalledWith('Offcloud error: NOAUTH', expect.any(Object));
	});
});
