import { beforeEach, describe, expect, it, vi } from 'vitest';

const oc = vi.hoisted(() => ({
	addOffcloudCloud: vi.fn(),
	// The pure helpers are the behaviour under test - `isValidBtih` is what stops
	// a zombie being created - so they are the real implementations, not stubs.
	isValidBtih: (hash: string) =>
		/^[0-9a-fA-F]{40}$/.test(hash.trim()) || /^[A-Za-z2-7]{32}$/.test(hash.trim()),
	toMagnetUri: (hash: string) =>
		hash.startsWith('magnet:') ? hash : `magnet:?xt=urn:btih:${hash.trim()}`,
	OffcloudError: class OffcloudError extends Error {
		code: string;
		constructor(message: string, code = 'unknown_error') {
			super(message);
			this.code = code;
		}
	},
}));

vi.mock('@/services/offcloud', () => oc);
vi.mock('@/services/premiumize', () => ({
	createPremiumizeTransfer: vi.fn(),
	listPremiumizeTransfers: vi.fn(),
	listPremiumizeFolder: vi.fn(),
	toMagnetUri: (hash: string) => `magnet:?xt=urn:btih:${hash}`,
	PremiumizeError: class PremiumizeError extends Error {},
}));
vi.mock('@/services/allDebrid', () => ({
	deleteMagnetAd: vi.fn(),
	getMagnetFiles: vi.fn(),
	getMagnetStatusAd: vi.fn(),
	isAdMagnetInstant: vi.fn(),
	isAdStatusReady: vi.fn(),
	restartMagnet: vi.fn(),
	uploadMagnet: vi.fn(),
	uploadMagnetAd: vi.fn(),
}));
vi.mock('@/services/realDebrid', () => ({
	addHashAsMagnet: vi.fn(),
	addTorrentFile: vi.fn(),
	getTorrentInfo: vi.fn(),
	hasRecentRdRateLimits: vi.fn(),
	recordRdRateLimit: vi.fn(),
	selectFiles: vi.fn(),
}));
vi.mock('@/services/torbox', () => ({
	controlTorrent: vi.fn(),
	createTorrent: vi.fn(),
	createWebDownload: vi.fn(),
	getTorrentList: vi.fn(),
	getWebDownloadList: vi.fn(),
	TorBoxRateLimitError: class TorBoxRateLimitError extends Error {},
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastPlain = vi.fn();
vi.mock('react-hot-toast', () => {
	const fn: any = (...args: unknown[]) => toastPlain(...args);
	fn.success = (...args: unknown[]) => toastSuccess(...args);
	fn.error = (...args: unknown[]) => toastError(...args);
	return { __esModule: true, default: fn };
});

import { handleAddAsMagnetInOc, handleAddMultipleHashesInOc } from './addMagnet';

const HASH = 'DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C';

const added = (status: string) => ({
	requestId: 'req-1',
	fileName: 'Big Buck Bunny',
	status,
	originalLink: `magnet:?xt=urn:btih:${HASH.toLowerCase()}`,
	createdOn: '2026-09-02T10:00:00.000Z',
});

beforeEach(() => {
	vi.clearAllMocks();
	oc.addOffcloudCloud.mockResolvedValue(added('downloaded'));
});

describe('handleAddAsMagnetInOc', () => {
	it('sends the full magnet form, never a bare hash', async () => {
		// `/cloud` would take a bare hash, but the magnet form is the house rule
		// for every Offcloud call that takes a url: its `/cache/info` sibling
		// silently reports cached content as uncached when handed a bare hash.
		await handleAddAsMagnetInOc('oc-key', HASH);

		expect(oc.addOffcloudCloud).toHaveBeenCalledWith('oc-key', `magnet:?xt=urn:btih:${HASH}`);
	});

	it('says the content is ready when Offcloud finished inside the add response', async () => {
		// A cached magnet answers `downloaded` synchronously, so the user can be
		// told to press play without a single poll.
		await handleAddAsMagnetInOc('oc-key', HASH);

		expect(toastSuccess).toHaveBeenCalledWith(
			'Cached on Offcloud — ready to play.',
			expect.any(Object)
		);
	});

	it('says it is downloading when Offcloud has not finished yet', async () => {
		oc.addOffcloudCloud.mockResolvedValue(added('created'));

		await handleAddAsMagnetInOc('oc-key', HASH);

		expect(toastSuccess).toHaveBeenCalledWith(
			'Added to Offcloud — downloading.',
			expect.any(Object)
		);
	});

	it('refuses a garbage hash before Offcloud can turn it into a zombie', async () => {
		// `magnet:?xt=urn:btih:zzzz` is accepted upstream with a 200 and a
		// requestId, then sits in `created` / "Loading..." forever with nothing
		// ever failing it. The only place that can refuse it is here.
		await expect(handleAddAsMagnetInOc('oc-key', 'zzzz')).rejects.toThrow(
			/not a valid info hash/
		);

		expect(oc.addOffcloudCloud).not.toHaveBeenCalled();
		expect(toastError).toHaveBeenCalledWith(
			'That is not a valid info hash.',
			expect.any(Object)
		);
	});

	it('builds a finished library row from the add response alone', async () => {
		const callback = vi.fn();

		await handleAddAsMagnetInOc('oc-key', HASH, callback);

		const [torrent] = callback.mock.calls[0];
		expect(torrent.id).toBe('oc:req-1');
		expect(torrent.hash).toBe(HASH.toLowerCase());
		expect(torrent.progress).toBe(100);
		expect(torrent.status).toBe('finished');
		expect(torrent.serviceStatus).toBe('downloaded');
		// Neither `/cloud` nor `/cloud/history` reports a size, so the row starts
		// at zero and is filled in when a modal asks `/cache/info` for the listing.
		expect(torrent.bytes).toBe(0);
	});

	// `created` is accepted-but-not-started, which is the state a zombie parks in
	// - calling it "downloading" would tell the user bytes are moving when
	// Offcloud has not begun and, for a garbage magnet, never will.
	it('marks an unstarted row as waiting, not downloading', async () => {
		oc.addOffcloudCloud.mockResolvedValue(added('created'));
		const callback = vi.fn();

		await handleAddAsMagnetInOc('oc-key', HASH, callback);

		const [torrent] = callback.mock.calls[0];
		expect(torrent.progress).toBe(0);
		expect(torrent.status).toBe('waiting');
		expect(torrent.serviceStatus).toBe('created');
	});

	it('marks a started row as downloading', async () => {
		oc.addOffcloudCloud.mockResolvedValue(added('downloading'));
		const callback = vi.fn();

		await handleAddAsMagnetInOc('oc-key', HASH, callback);

		const [torrent] = callback.mock.calls[0];
		expect(torrent.progress).toBe(0);
		expect(torrent.status).toBe('downloading');
	});

	it('rethrows so a batch can count the failure, and reports the vendor message', async () => {
		oc.addOffcloudCloud.mockRejectedValue(new oc.OffcloudError('NOAUTH', 'NOAUTH'));

		await expect(handleAddAsMagnetInOc('oc-key', HASH)).rejects.toThrow();
		expect(toastError).toHaveBeenCalledWith('Offcloud error: NOAUTH', expect.any(Object));
	});

	it('stays quiet when asked to', async () => {
		oc.addOffcloudCloud.mockRejectedValue(new Error('nope'));

		await expect(handleAddAsMagnetInOc('oc-key', HASH, undefined, true)).rejects.toThrow();
		expect(toastError).not.toHaveBeenCalled();
	});

	it('stays quiet about an invalid hash when asked to', async () => {
		await expect(handleAddAsMagnetInOc('oc-key', 'zzzz', undefined, true)).rejects.toThrow();
		expect(toastError).not.toHaveBeenCalled();
	});
});

describe('handleAddMultipleHashesInOc', () => {
	it('counts only the hashes that landed', async () => {
		oc.addOffcloudCloud
			.mockResolvedValueOnce(added('downloaded'))
			.mockRejectedValueOnce(new Error('nope'))
			.mockResolvedValueOnce(added('downloaded'));
		const callback = vi.fn();

		await handleAddMultipleHashesInOc(
			'oc-key',
			[HASH, 'DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1D', HASH],
			callback
		);

		expect(callback).toHaveBeenCalled();
		expect(oc.addOffcloudCloud).toHaveBeenCalledTimes(3);
		expect(toastPlain).toHaveBeenCalledWith('Added 2 hashes to Offcloud.', expect.any(Object));
	});

	it('skips an invalid hash without spending a request on it', async () => {
		await handleAddMultipleHashesInOc('oc-key', ['zzzz', HASH]);

		expect(oc.addOffcloudCloud).toHaveBeenCalledTimes(1);
		expect(toastPlain).toHaveBeenCalledWith('Added 1 hash to Offcloud.', expect.any(Object));
	});
});
