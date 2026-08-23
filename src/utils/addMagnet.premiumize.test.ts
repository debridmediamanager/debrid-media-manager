import { beforeEach, describe, expect, it, vi } from 'vitest';

const pm = vi.hoisted(() => ({
	createPremiumizeTransfer: vi.fn(),
	listPremiumizeTransfers: vi.fn(),
	listPremiumizeFolder: vi.fn(),
	toMagnetUri: (hash: string) =>
		hash.startsWith('magnet:') ? hash : `magnet:?xt=urn:btih:${hash}`,
	PremiumizeError: class PremiumizeError extends Error {
		code: string;
		constructor(message: string, code = 'unknown_error') {
			super(message);
			this.code = code;
		}
	},
}));

vi.mock('@/services/premiumize', () => pm);
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
vi.mock('react-hot-toast', () => {
	const fn: any = vi.fn();
	fn.success = (...args: unknown[]) => toastSuccess(...args);
	fn.error = (...args: unknown[]) => toastError(...args);
	return { __esModule: true, default: fn };
});

import { handleAddAsMagnetInPm, handleAddMultipleHashesInPm } from './addMagnet';

const HASH = 'DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C';

beforeEach(() => {
	vi.clearAllMocks();
	pm.createPremiumizeTransfer.mockResolvedValue({ status: 'success', id: 'tid', name: 'BBB' });
	pm.listPremiumizeTransfers.mockResolvedValue([
		{
			id: 'tid',
			name: 'Big Buck Bunny',
			message: null,
			status: 'finished',
			progress: null,
			folder_id: 'fid',
			file_id: null,
		},
	]);
	pm.listPremiumizeFolder.mockImplementation(async (_key: string, folderId?: string) =>
		folderId
			? {
					content: [
						{
							id: 'file1',
							name: 'Big Buck Bunny.mp4',
							type: 'file',
							size: 276134947,
							created_at: 1787442631,
						},
					],
				}
			: { content: [{ id: 'fid', name: 'Big Buck Bunny', type: 'folder' }] }
	);
});

describe('handleAddAsMagnetInPm', () => {
	it('sends a full magnet URI - Premiumize rejects a bare hash', async () => {
		await handleAddAsMagnetInPm('pm-key', HASH);

		expect(pm.createPremiumizeTransfer).toHaveBeenCalledWith(
			'pm-key',
			`magnet:?xt=urn:btih:${HASH}`
		);
		expect(toastSuccess).toHaveBeenCalled();
	});

	it('builds a finished library row from the transfer it just created', async () => {
		const callback = vi.fn();

		await handleAddAsMagnetInPm('pm-key', HASH, callback);

		const [torrent] = callback.mock.calls[0];
		expect(torrent.id).toBe('pm:ttid');
		expect(torrent.hash).toBe(HASH.toLowerCase());
		expect(torrent.bytes).toBe(276134947);
		expect(torrent.progress).toBe(100);
	});

	it('reads only the transfer folder, never the whole account, for one add', async () => {
		await handleAddAsMagnetInPm('pm-key', HASH, vi.fn());

		expect(pm.listPremiumizeFolder).toHaveBeenCalledWith('pm-key', 'fid');
		// item/listall would pull every file in the cloud back for a single add
		expect(pm.listPremiumizeTransfers).toHaveBeenCalledTimes(1);
	});

	it('does not read the account back at all when no row is wanted', async () => {
		await handleAddAsMagnetInPm('pm-key', HASH);

		expect(pm.listPremiumizeTransfers).not.toHaveBeenCalled();
		expect(pm.listPremiumizeFolder).not.toHaveBeenCalled();
	});

	it('rethrows so a batch can count the failure, and reports the vendor message', async () => {
		pm.createPremiumizeTransfer.mockRejectedValue(
			new pm.PremiumizeError('Error downloading this file.', 'transient_error')
		);

		await expect(handleAddAsMagnetInPm('pm-key', HASH)).rejects.toThrow();
		expect(toastError).toHaveBeenCalledWith(
			'Premiumize error: Error downloading this file.',
			expect.any(Object)
		);
	});

	it('stays quiet when asked to', async () => {
		pm.createPremiumizeTransfer.mockRejectedValue(new Error('nope'));

		await expect(handleAddAsMagnetInPm('pm-key', HASH, undefined, true)).rejects.toThrow();
		expect(toastError).not.toHaveBeenCalled();
	});
});

describe('handleAddMultipleHashesInPm', () => {
	it('counts only the hashes that landed', async () => {
		pm.createPremiumizeTransfer
			.mockResolvedValueOnce({ status: 'success', id: 'a', name: 'A' })
			.mockRejectedValueOnce(new Error('nope'))
			.mockResolvedValueOnce({ status: 'success', id: 'c', name: 'C' });
		const callback = vi.fn();

		await handleAddMultipleHashesInPm('pm-key', ['a', 'b', 'c'], callback);

		expect(callback).toHaveBeenCalled();
		expect(pm.createPremiumizeTransfer).toHaveBeenCalledTimes(3);
	});
});
