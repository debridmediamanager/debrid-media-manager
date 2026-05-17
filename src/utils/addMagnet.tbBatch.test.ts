import { TorBoxRateLimitError } from '@/services/torbox';
import { TorBoxTorrentInfo } from '@/services/types';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	handleAddAsMagnetInTb,
	handleAddMultipleHashesInTb,
	handleAddMultipleTorrentFilesInTb,
} from './addMagnet';

const mocks = vi.hoisted(() => ({
	createTorrent: vi.fn(),
	getTorrentList: vi.fn(),
	controlTorrent: vi.fn(),
}));

vi.mock('@/services/torbox', async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		createTorrent: mocks.createTorrent,
		getTorrentList: mocks.getTorrentList,
		controlTorrent: mocks.controlTorrent,
	};
});

vi.mock('@/services/realDebrid');
vi.mock('@/services/allDebrid');
vi.mock('./deleteTorrent');
vi.mock('./fetchTorrents', () => ({
	convertToTbUserTorrent: (info: any) => ({
		id: `tb:${info.id}`,
		hash: info.hash || 'testhash',
		filename: info.name || 'test.mkv',
		title: info.name || 'Test',
		bytes: 1000,
		progress: 100,
		status: 'finished',
		serviceStatus: 'cached',
		added: new Date(),
		mediaType: 'movie',
		links: [],
		selectedFiles: [],
		seeders: 0,
		speed: 0,
	}),
}));

vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		promise: vi.fn(),
	}),
}));

const delaySpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/utils/delay', () => ({ delay: delaySpy }));

const makeTorrentInfo = (id: number): TorBoxTorrentInfo =>
	({
		id,
		hash: `hash${id}`,
		name: `torrent-${id}`,
		download_state: 'cached',
		download_finished: true,
		files: [{ id: 0, name: 'video.mkv', size: 1000, short_name: 'video.mkv' }],
	}) as any;

describe('TorBox batch magnet pacing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delaySpy.mockResolvedValue(undefined);

		mocks.createTorrent.mockResolvedValue({
			success: true,
			data: { torrent_id: 1 },
		});

		mocks.getTorrentList.mockResolvedValue({
			success: true,
			data: makeTorrentInfo(1),
		});
	});

	describe('handleAddMultipleHashesInTb', () => {
		it('calls delay between hash additions', async () => {
			const hashes = ['hash1', 'hash2', 'hash3'];
			let callIndex = 0;
			mocks.createTorrent.mockImplementation(async () => {
				callIndex++;
				return { success: true, data: { torrent_id: callIndex } };
			});
			mocks.getTorrentList.mockImplementation(async (_key: string, params: any) => ({
				success: true,
				data: makeTorrentInfo(params?.id ?? callIndex),
			}));

			const delayCallsBefore = delaySpy.mock.calls.length;
			await handleAddMultipleHashesInTb('tbkey', hashes);
			const delayCallsAfter = delaySpy.mock.calls.length;

			// Should have at least 2 inter-item delays (between items 0-1 and 1-2)
			// In test env TB_BATCH_MAGNET_DELAY is 0, so delay(0) is called
			expect(delayCallsAfter - delayCallsBefore).toBeGreaterThanOrEqual(2);
		});

		it('processes all hashes', async () => {
			let callIndex = 0;
			mocks.createTorrent.mockImplementation(async () => {
				callIndex++;
				return { success: true, data: { torrent_id: callIndex } };
			});
			mocks.getTorrentList.mockImplementation(async (_key: string, params: any) => ({
				success: true,
				data: makeTorrentInfo(params?.id ?? callIndex),
			}));

			await handleAddMultipleHashesInTb('tbkey', ['hash1']);

			expect(mocks.createTorrent).toHaveBeenCalledTimes(1);
		});

		it('stops processing on rate limit error', async () => {
			mocks.createTorrent
				.mockResolvedValueOnce({ success: true, data: { torrent_id: 1 } })
				.mockRejectedValueOnce(new TorBoxRateLimitError());

			await handleAddMultipleHashesInTb('tbkey', ['hash1', 'hash2', 'hash3']);

			expect(mocks.createTorrent).toHaveBeenCalledTimes(2);
		});

		it('continues on non-rate-limit errors', async () => {
			mocks.createTorrent
				.mockResolvedValueOnce({ success: true, data: { torrent_id: 1 } })
				.mockRejectedValueOnce(new Error('some other error'))
				.mockResolvedValueOnce({ success: true, data: { torrent_id: 3 } });

			await handleAddMultipleHashesInTb('tbkey', ['hash1', 'hash2', 'hash3']);

			expect(mocks.createTorrent).toHaveBeenCalledTimes(3);
		});

		it('reports correct count when rate limited mid-batch', async () => {
			mocks.createTorrent
				.mockResolvedValueOnce({ success: true, data: { torrent_id: 1 } })
				.mockRejectedValueOnce(new TorBoxRateLimitError());

			await handleAddMultipleHashesInTb('tbkey', ['h1', 'h2', 'h3']);

			// First hash succeeds, second fails with rate limit, third is skipped.
			expect(toast).toHaveBeenCalledWith(
				expect.stringContaining('1 hash'),
				expect.anything()
			);
		});
	});

	describe('handleAddMultipleTorrentFilesInTb', () => {
		it('calls delay between file additions', async () => {
			const files = [new File(['a'], 'a.torrent'), new File(['b'], 'b.torrent')];
			let callIndex = 0;
			mocks.createTorrent.mockImplementation(async () => {
				callIndex++;
				return { success: true, data: { torrent_id: callIndex } };
			});
			mocks.getTorrentList.mockImplementation(async (_key: string, params: any) => ({
				success: true,
				data: makeTorrentInfo(params?.id ?? callIndex),
			}));

			const delayCallsBefore = delaySpy.mock.calls.length;
			await handleAddMultipleTorrentFilesInTb('tbkey', files);
			const delayCallsAfter = delaySpy.mock.calls.length;

			expect(delayCallsAfter - delayCallsBefore).toBeGreaterThanOrEqual(1);
		});

		it('processes single file without inter-item delay', async () => {
			const files = [new File(['a'], 'a.torrent')];
			await handleAddMultipleTorrentFilesInTb('tbkey', files);

			expect(mocks.createTorrent).toHaveBeenCalledTimes(1);
		});

		it('stops on rate limit and reports partial success', async () => {
			const files = [
				new File(['a'], 'a.torrent'),
				new File(['b'], 'b.torrent'),
				new File(['c'], 'c.torrent'),
			];
			mocks.createTorrent
				.mockResolvedValueOnce({ success: true, data: { torrent_id: 1 } })
				.mockRejectedValueOnce(new TorBoxRateLimitError());

			await handleAddMultipleTorrentFilesInTb('tbkey', files);

			expect(mocks.createTorrent).toHaveBeenCalledTimes(2);
			expect((toast as any).error).toHaveBeenCalledWith(
				expect.stringContaining('rate limit'),
				expect.anything()
			);
		});
	});

	describe('handleAddAsMagnetInTb', () => {
		it('prefixes bare hashes with magnet URI', async () => {
			await handleAddAsMagnetInTb('tbkey', 'abc123');

			expect(mocks.createTorrent).toHaveBeenCalledWith('tbkey', {
				magnet: 'magnet:?xt=urn:btih:abc123',
			});
		});

		it('does not double-prefix magnet URIs', async () => {
			await handleAddAsMagnetInTb('tbkey', 'magnet:?xt=urn:btih:abc123');

			expect(mocks.createTorrent).toHaveBeenCalledWith('tbkey', {
				magnet: 'magnet:?xt=urn:btih:abc123',
			});
		});

		it('throws TorBoxRateLimitError on rate limit', async () => {
			mocks.createTorrent.mockRejectedValue(new TorBoxRateLimitError());

			await expect(handleAddAsMagnetInTb('tbkey', 'hash')).rejects.toThrow(
				TorBoxRateLimitError
			);
		});
	});
});
