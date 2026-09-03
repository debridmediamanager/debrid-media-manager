import { beforeEach, describe, expect, it, vi } from 'vitest';

const dl = vi.hoisted(() => ({
	addSeedboxTorrent: vi.fn(),
	// The pure helpers are part of the behaviour under test - `toMagnetUri` is
	// what separates the search-page add from the hash-list one, and the `>=`
	// threshold is what decides which toast a user sees - so they are the real
	// implementations rather than stubs.
	toMagnetUri: (hashOrMagnet: string) =>
		hashOrMagnet.startsWith('magnet:')
			? hashOrMagnet
			: `magnet:?xt=urn:btih:${hashOrMagnet.trim()}`,
	isDlFinished: (status: number) => status >= 100,
	// `convertToDlUserTorrent` now lives in `fetchTorrents` and reads the real
	// status mapping, which needs the enum and the pager binding to exist.
	DL_STATUS: { PAUSED: 0, QUEUED: 1, VERIFICATION: 2, DOWNLOADING: 4, SEEDING: 8, FINISHED: 100 },
	listAllSeedboxTorrents: vi.fn(),
	DebridLinkError: class DebridLinkError extends Error {
		code: string;
		retryAfterMs?: number;
		constructor(message: string, code = 'unknown_error', retryAfterMs?: number) {
			super(message);
			this.name = 'DebridLinkError';
			this.code = code;
			this.retryAfterMs = retryAfterMs;
		}
	},
}));

const FakeDebridLinkError = dl.DebridLinkError;

vi.mock('@/services/debridLink', () => dl);
vi.mock('@/services/offcloud', () => ({
	addOffcloudCloud: vi.fn(),
	isValidBtih: () => true,
	toMagnetUri: (hash: string) => `magnet:?xt=urn:btih:${hash}`,
	OffcloudError: class OffcloudError extends Error {},
}));
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

import { handleAddAsMagnetInDl, handleAddMultipleHashesInDl } from './addMagnet';

const HASH = 'DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C';
const HASH2 = 'DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1D';

const torrent = (status: number, over: Record<string, unknown> = {}) => ({
	id: 'seed-1',
	name: 'Big Buck Bunny',
	hashString: HASH.toLowerCase(),
	created: 1_756_000_000,
	status,
	totalSize: 276_134_947,
	downloadPercent: status >= 100 ? 100 : 42,
	downloadSpeed: 0,
	isZip: false,
	files: [],
	...over,
});

const failWith = (code: string, retryAfterMs?: number) =>
	dl.addSeedboxTorrent.mockRejectedValue(new FakeDebridLinkError(code, code, retryAfterMs));

beforeEach(() => {
	vi.clearAllMocks();
	dl.addSeedboxTorrent.mockResolvedValue(torrent(100));
});

describe('handleAddAsMagnetInDl', () => {
	it('sends the FULL magnet, never a bare hash', async () => {
		// A bare hash is only accepted when the content is already cached - that
		// is Debrid-Link's whole cache probe now that `/seedbox/cached` is gone.
		// On a search page the button means "add this", so an uncached release
		// has to download for real rather than be refused with `notAddTorrent`.
		await handleAddAsMagnetInDl('dl-key', HASH);

		expect(dl.addSeedboxTorrent).toHaveBeenCalledWith('dl-key', `magnet:?xt=urn:btih:${HASH}`);
	});

	it('says the content is ready when the add came back complete', async () => {
		await handleAddAsMagnetInDl('dl-key', HASH);

		expect(toastSuccess).toHaveBeenCalledWith(
			'Cached on Debrid-Link — ready to play.',
			expect.any(Object)
		);
	});

	it('says it is downloading when the add has not finished', async () => {
		dl.addSeedboxTorrent.mockResolvedValue(torrent(4));

		await handleAddAsMagnetInDl('dl-key', HASH);

		expect(toastSuccess).toHaveBeenCalledWith(
			'Added to Debrid-Link — downloading.',
			expect.any(Object)
		);
	});

	it('treats a combined status flag as unfinished, never as done', async () => {
		// The vendor's own documentation sample carries `status: 6`, which is
		// VERIFICATION(2)|DOWNLOADING(4) and equals no single enum member. An
		// equality test against 100 would be right here by accident; an equality
		// test against a state would not.
		dl.addSeedboxTorrent.mockResolvedValue(torrent(6));

		await handleAddAsMagnetInDl('dl-key', HASH);

		expect(toastSuccess).toHaveBeenCalledWith(
			'Added to Debrid-Link — downloading.',
			expect.any(Object)
		);
	});

	it('builds a finished library row out of the add response alone', async () => {
		const callback = vi.fn();

		await handleAddAsMagnetInDl('dl-key', HASH, callback);

		const [row] = callback.mock.calls[0];
		expect(row.id).toBe('dl:seed-1');
		expect(row.hash).toBe(HASH.toLowerCase());
		expect(row.progress).toBe(100);
		expect(row.status).toBe('finished');
		// Unlike Premiumize and Offcloud, the add response carries the size, so
		// nothing has to be read back to build a complete row.
		expect(row.bytes).toBe(276_134_947);
	});

	it('marks an unfinished row as downloading with its real percentage', async () => {
		dl.addSeedboxTorrent.mockResolvedValue(torrent(4));
		const callback = vi.fn();

		await handleAddAsMagnetInDl('dl-key', HASH, callback);

		const [row] = callback.mock.calls[0];
		expect(row.status).toBe('downloading');
		expect(row.progress).toBe(42);
	});

	it('keeps the keyless per-file URLs off the library row', async () => {
		// A Debrid-Link download URL is the entire capability - no token, no IP
		// binding - and it keeps serving after the torrent is deleted. It does
		// not belong in a cache the app writes to disk.
		const callback = vi.fn();
		dl.addSeedboxTorrent.mockResolvedValue(
			torrent(100, {
				files: [
					{
						id: 'f1',
						name: 'Big Buck Bunny.mp4',
						size: 276_134_947,
						downloadUrl: 'https://seed41.debrid.link/dl/s37yg6ws-2/Big+Buck+Bunny.mp4',
					},
				],
			})
		);

		await handleAddAsMagnetInDl('dl-key', HASH, callback);

		const [row] = callback.mock.calls[0];
		expect(row.links).toEqual([]);
		expect(JSON.stringify(row)).not.toContain('debrid.link/dl/');
	});

	describe('error messages', () => {
		it.each([
			['maxTorrent', /Daily Debrid-Link torrent quota \(50\) reached/],
			['maxData', /daily data quota/],
			['torrentTooBig', /1 TiB/],
			['maxTransfer', /20 active transfers/],
			['badTorrentFile', /could not read that magnet/],
			['notAddTorrent', /Not cached on Debrid-Link/],
		])('maps %s to something the user can act on', async (code, expected) => {
			failWith(code);

			await expect(handleAddAsMagnetInDl('dl-key', HASH)).rejects.toThrow();
			expect(toastError).toHaveBeenCalledWith(
				expect.stringMatching(expected),
				expect.any(Object)
			);
		});

		it('reports the flood lockout with the minutes actually left', async () => {
			// The lockout is an hour long and per endpoint, so "try again" without
			// a number invites the user to spend the hour finding out.
			failWith('floodDetected', 12 * 60_000);

			await expect(handleAddAsMagnetInDl('dl-key', HASH)).rejects.toThrow();
			expect(toastError).toHaveBeenCalledWith(
				'Debrid-Link rate-limited this action — locked for about 12 more minutes.',
				expect.any(Object)
			);
		});

		it('falls back to the plain hour when no remainder is known', async () => {
			failWith('floodDetected');

			await expect(handleAddAsMagnetInDl('dl-key', HASH)).rejects.toThrow();
			expect(toastError).toHaveBeenCalledWith(
				'Debrid-Link rate-limited this action — locked for an hour.',
				expect.any(Object)
			);
		});

		it('rethrows so a batch can count the failure', async () => {
			failWith('maxTorrent');

			await expect(handleAddAsMagnetInDl('dl-key', HASH)).rejects.toThrow();
		});

		it('stays quiet when asked to', async () => {
			failWith('maxTorrent');

			await expect(handleAddAsMagnetInDl('dl-key', HASH, undefined, true)).rejects.toThrow();
			expect(toastError).not.toHaveBeenCalled();
		});
	});
});

describe('handleAddMultipleHashesInDl', () => {
	it('sends BARE hashes, so nothing uncached starts a real download', async () => {
		// One click on a hash list is hundreds of rows against a 50-a-day quota.
		// A bare hash lands only if Debrid-Link already holds the content, which
		// is exactly the "only if cached" semantics this surface wants.
		await handleAddMultipleHashesInDl('dl-key', [HASH]);

		expect(dl.addSeedboxTorrent).toHaveBeenCalledWith('dl-key', HASH);
		expect(dl.addSeedboxTorrent).not.toHaveBeenCalledWith(
			'dl-key',
			expect.stringContaining('magnet:')
		);
	});

	it('counts the cache misses separately from real refusals', async () => {
		dl.addSeedboxTorrent
			.mockResolvedValueOnce(torrent(100))
			.mockRejectedValueOnce(new FakeDebridLinkError('notAddTorrent', 'notAddTorrent'))
			.mockRejectedValueOnce(new FakeDebridLinkError('notDebrid', 'notDebrid'));
		const callback = vi.fn();

		await handleAddMultipleHashesInDl('dl-key', [HASH, HASH2, HASH], callback);

		expect(callback).toHaveBeenCalled();
		expect(toastPlain).toHaveBeenCalledWith(
			'Added 1 hash to Debrid-Link — 1 not cached — 1 refused.',
			expect.any(Object)
		);
	});

	it('stops the sweep the moment the daily quota is gone', async () => {
		// Every remaining add would be refused for the rest of the day, so
		// carrying on spends requests to collect the same answer.
		dl.addSeedboxTorrent
			.mockResolvedValueOnce(torrent(100))
			.mockRejectedValueOnce(new FakeDebridLinkError('maxTorrent', 'maxTorrent'));

		await handleAddMultipleHashesInDl('dl-key', [HASH, HASH2, HASH, HASH2]);

		expect(dl.addSeedboxTorrent).toHaveBeenCalledTimes(2);
		expect(toastError).toHaveBeenCalledWith(
			expect.stringMatching(/Daily Debrid-Link torrent quota \(50\) reached/),
			expect.any(Object)
		);
	});

	it('stops the sweep on a flood lockout rather than spending the hour', async () => {
		dl.addSeedboxTorrent
			.mockResolvedValueOnce(torrent(100))
			.mockRejectedValueOnce(new FakeDebridLinkError('floodDetected', 'floodDetected'));

		await handleAddMultipleHashesInDl('dl-key', [HASH, HASH2, HASH, HASH2]);

		expect(dl.addSeedboxTorrent).toHaveBeenCalledTimes(2);
		expect(toastError).toHaveBeenCalledWith(
			expect.stringMatching(/locked for an hour\. Stopped early\./),
			expect.any(Object)
		);
	});

	it('reports a clean sweep without inventing failure counts', async () => {
		await handleAddMultipleHashesInDl('dl-key', [HASH, HASH2]);

		expect(toastPlain).toHaveBeenCalledWith(
			'Added 2 hashes to Debrid-Link.',
			expect.any(Object)
		);
	});
});
