import {
	getMagnetStatusAd,
	isAdMagnetInstant,
	restartMagnet,
	uploadMagnet,
	uploadMagnetAd,
} from '@/services/allDebrid';
import {
	addHashAsMagnet,
	addTorrentFile,
	getTorrentInfo,
	selectFiles,
} from '@/services/realDebrid';
import { createTorrent, getTorrentList } from '@/services/torbox';
import { TorBoxTorrentInfo, TorrentInfoResponse } from '@/services/types';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInRd,
	handleAddAsMagnetInTb,
	handleAddMultipleHashesInAd,
	handleAddMultipleHashesInRd,
	handleAddMultipleTorrentFilesInRd,
	handleAddTorrentFileInRd,
	handleReinsertTorrentinRd,
	handleRestartTorrent,
	handleSelectFilesInRd,
} from './addMagnet';
import { handleDeleteRdTorrent } from './deleteTorrent';
import { convertToTbUserTorrent } from './fetchTorrents';

// Mock all dependencies
vi.mock('@/services/allDebrid');
vi.mock('@/services/realDebrid');
vi.mock('@/services/torbox');
vi.mock('./deleteTorrent');
vi.mock('./fetchTorrents');
vi.mock('react-hot-toast', () => {
	const fn: any = vi.fn((message: string) => {});
	fn.success = vi.fn();
	fn.error = vi.fn();
	return { default: fn };
});

describe('addMagnet utilities', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('handleAddAsMagnetInRd', () => {
		const rdKey = 'test-rd-key';
		const hash = 'test-hash-123';

		it('should successfully add magnet and select files', async () => {
			const mockId = 'torrent-456';
			const mockTorrentInfo: TorrentInfoResponse = {
				id: mockId,
				status: 'downloaded',
				progress: 100,
				files: [{ id: 1, path: 'video.mkv', selected: 1, bytes: 1000000 }],
				links: ['https://example.com/file1'],
			} as any;

			vi.mocked(addHashAsMagnet).mockResolvedValue(mockId);
			vi.mocked(getTorrentInfo).mockResolvedValue(mockTorrentInfo);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			const callback = vi.fn();
			await handleAddAsMagnetInRd(rdKey, hash, callback);

			expect(addHashAsMagnet).toHaveBeenCalledWith(rdKey, hash);
			expect(getTorrentInfo).toHaveBeenCalledWith(rdKey, mockId, false);
			expect(callback).toHaveBeenCalledWith(mockTorrentInfo);
			expect(toast.success).toHaveBeenCalledWith('Torrent added.', expect.any(Object));
		});

		it('should handle 509 error and retry after delay', async () => {
			const error = new AxiosError('Download slots full');
			error.response = { status: 509 } as any;

			vi.mocked(addHashAsMagnet)
				.mockRejectedValueOnce(error)
				.mockResolvedValueOnce('torrent-456');
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'torrent-456',
				status: 'downloaded',
				progress: 100,
				files: [],
				links: [],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			const callback = vi.fn();
			await handleAddAsMagnetInRd(rdKey, hash, callback);

			expect(toast.error).toHaveBeenCalledWith(
				'RD slots full. Retrying in 5s... (1/5)',
				expect.objectContaining({ duration: 5000 })
			);
			expect(addHashAsMagnet).toHaveBeenCalledTimes(2);
		});

		it('should show RD API error when present in response', async () => {
			const error = new AxiosError('Infringing content');
			error.response = {
				status: 403,
				data: { error: 'infringing_file', error_code: 35 },
			} as any;

			vi.mocked(addHashAsMagnet).mockRejectedValue(error);

			await handleAddAsMagnetInRd(rdKey, hash);

			expect(toast.error).toHaveBeenCalledWith(
				'RD error: infringing_file',
				expect.any(Object)
			);
		});

		it('should handle generic errors', async () => {
			const error = new Error('Network error');
			vi.mocked(addHashAsMagnet).mockRejectedValue(error);

			await handleAddAsMagnetInRd(rdKey, hash);

			expect(toast.error).toHaveBeenCalledWith('Failed to add hash.', expect.any(Object));
		});

		it('should show error when status is not downloaded', async () => {
			vi.mocked(addHashAsMagnet).mockResolvedValue('torrent-456');
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'torrent-456',
				status: 'downloading',
				progress: 50,
				files: [],
				links: [],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			await handleAddAsMagnetInRd(rdKey, hash);

			expect(toast.error).toHaveBeenCalledWith(
				'Torrent added with status downloading.',
				expect.any(Object)
			);
		});

		it('should delete torrent when deleteIfNotInstant is true and status is not downloaded', async () => {
			vi.mocked(addHashAsMagnet).mockResolvedValue('torrent-456');
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'torrent-456',
				status: 'downloading',
				progress: 50,
				files: [],
				links: [],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);
			vi.mocked(handleDeleteRdTorrent).mockResolvedValue(true);

			const callback = vi.fn();
			await handleAddAsMagnetInRd(rdKey, hash, callback, true);

			expect(handleDeleteRdTorrent).toHaveBeenCalledWith(rdKey, 'rd:torrent-456', true);
			expect(toast.error).toHaveBeenCalledWith(
				'Torrent not instant; removed.',
				expect.any(Object)
			);
			expect(callback).not.toHaveBeenCalled();
		});

		it('should not delete torrent when deleteIfNotInstant is true but status is downloaded', async () => {
			vi.mocked(addHashAsMagnet).mockResolvedValue('torrent-456');
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'torrent-456',
				status: 'downloaded',
				progress: 100,
				files: [{ id: 1, path: 'video.mkv', selected: 1, bytes: 1000000 }],
				links: ['https://example.com/file1'],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			const callback = vi.fn();
			await handleAddAsMagnetInRd(rdKey, hash, callback, true);

			expect(handleDeleteRdTorrent).not.toHaveBeenCalled();
			expect(toast.success).toHaveBeenCalledWith('Torrent added.', expect.any(Object));
			expect(callback).toHaveBeenCalled();
		});
	});

	describe('handleAddTorrentFileInRd', () => {
		const rdKey = 'test-rd-key';
		const file = new File(['test content'], 'test.torrent');

		it('should successfully add torrent file', async () => {
			const mockId = 'torrent-789';
			const mockTorrentInfo: TorrentInfoResponse = {
				id: mockId,
				status: 'downloaded',
				progress: 100,
				files: [{ id: 1, path: 'video.mp4', selected: 1, bytes: 2000000 }],
				links: ['https://example.com/file2'],
			} as any;

			vi.mocked(addTorrentFile).mockResolvedValue(mockId);
			vi.mocked(getTorrentInfo).mockResolvedValue(mockTorrentInfo);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			const callback = vi.fn();
			await handleAddTorrentFileInRd(rdKey, file, callback);

			expect(addTorrentFile).toHaveBeenCalledWith(rdKey, file);
			expect(getTorrentInfo).toHaveBeenCalledWith(rdKey, mockId, false);
			expect(callback).toHaveBeenCalledWith(mockTorrentInfo);
			expect(toast.success).toHaveBeenCalledWith('Torrent file added.', expect.any(Object));
		});

		it('should handle 509 error and retry', async () => {
			const error = new AxiosError('Download slots full');
			error.response = { status: 509 } as any;

			vi.mocked(addTorrentFile)
				.mockRejectedValueOnce(error)
				.mockResolvedValueOnce('torrent-789');
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'torrent-789',
				status: 'downloaded',
				progress: 100,
				files: [],
				links: [],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			await handleAddTorrentFileInRd(rdKey, file);

			expect(toast.error).toHaveBeenCalledWith(
				'RD slots full. Retrying in 5s... (1/5)',
				expect.objectContaining({ duration: 5000 })
			);
			expect(addTorrentFile).toHaveBeenCalledTimes(2);
		});

		it('should show RD API error when present in response', async () => {
			const error = new AxiosError('Infringing content');
			error.response = {
				status: 403,
				data: { error: 'infringing_file', error_code: 35 },
			} as any;

			vi.mocked(addTorrentFile).mockRejectedValue(error);

			await handleAddTorrentFileInRd(rdKey, file);

			expect(toast.error).toHaveBeenCalledWith(
				'RD error: infringing_file',
				expect.any(Object)
			);
		});
	});

	describe('handleAddMultipleTorrentFilesInRd', () => {
		const rdKey = 'test-rd-key';
		const files = [
			new File(['content1'], 'test1.torrent'),
			new File(['content2'], 'test2.torrent'),
			new File(['content3'], 'test3.torrent'),
		];

		it('should add multiple torrent files successfully', async () => {
			vi.mocked(addTorrentFile)
				.mockResolvedValueOnce('id1')
				.mockResolvedValueOnce('id2')
				.mockResolvedValueOnce('id3');
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'test',
				files: [],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			const callback = vi.fn();
			await handleAddMultipleTorrentFilesInRd(rdKey, files, callback);

			expect(addTorrentFile).toHaveBeenCalledTimes(3);
			expect(callback).toHaveBeenCalled();
			expect(toast).toHaveBeenCalledWith('Added 3 torrent files.', expect.any(Object));
		});

		it('should handle partial failures', async () => {
			vi.mocked(addTorrentFile)
				.mockResolvedValueOnce('id1')
				.mockRejectedValueOnce(new Error('Failed'))
				.mockResolvedValueOnce('id3');
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'test',
				files: [],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			await handleAddMultipleTorrentFilesInRd(rdKey, files);

			expect(addTorrentFile).toHaveBeenCalledTimes(3);
			expect(toast.error).toHaveBeenCalledWith('Failed to add torrent file.');
			expect(toast).toHaveBeenCalledWith('Added 2 torrent files.', expect.any(Object));
		});
	});

	describe('handleAddMultipleHashesInRd', () => {
		const rdKey = 'test-rd-key';
		const hashes = ['hash1', 'hash2', 'hash3'];

		it('should add multiple hashes successfully', async () => {
			vi.mocked(addHashAsMagnet)
				.mockResolvedValueOnce('id1')
				.mockResolvedValueOnce('id2')
				.mockResolvedValueOnce('id3');
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'test',
				files: [],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			const callback = vi.fn();
			await handleAddMultipleHashesInRd(rdKey, hashes, callback);

			expect(addHashAsMagnet).toHaveBeenCalledTimes(3);
			expect(callback).toHaveBeenCalled();
			expect(toast).toHaveBeenCalledWith('Added 3 hashes.', expect.any(Object));
		});

		it('should handle partial failures', async () => {
			vi.mocked(addHashAsMagnet)
				.mockResolvedValueOnce('id1')
				.mockRejectedValueOnce(new Error('Failed'))
				.mockResolvedValueOnce('id3');
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'test',
				files: [],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			await handleAddMultipleHashesInRd(rdKey, hashes);

			expect(addHashAsMagnet).toHaveBeenCalledTimes(3);
			expect(toast.error).toHaveBeenCalledWith('Failed to add hash.');
			expect(toast).toHaveBeenCalledWith('Added 2 hashes.', expect.any(Object));
		});
	});

	describe('handleSelectFilesInRd', () => {
		const rdKey = 'test-rd-key';

		it('should select video files automatically', async () => {
			const torrentId = 'rd:123';
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: '123',
				files: [
					{ id: 1, path: 'video.mkv', bytes: 1000000 },
					{ id: 2, path: 'video.mp4', bytes: 2000000 },
					{ id: 3, path: 'readme.txt', bytes: 1000 },
				],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			await handleSelectFilesInRd(rdKey, torrentId);

			expect(getTorrentInfo).toHaveBeenCalledWith(rdKey, '123', false);
			expect(selectFiles).toHaveBeenCalledWith(rdKey, '123', ['1', '2'], false);
		});

		it('should select all files if no videos found', async () => {
			const torrentId = 'rd:456';
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: '456',
				files: [
					{ id: 1, path: 'readme.txt', bytes: 1000 },
					{ id: 2, path: 'data.json', bytes: 2000 },
				],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			await handleSelectFilesInRd(rdKey, torrentId);

			expect(selectFiles).toHaveBeenCalledWith(rdKey, '456', ['1', '2'], false);
		});

		it('should handle torrents with no files', async () => {
			const torrentId = 'rd:789';
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: '789',
				files: [],
			} as any);

			await handleSelectFilesInRd(rdKey, torrentId);

			expect(selectFiles).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			const torrentId = 'rd:999';
			const error = new Error('Network error');
			vi.mocked(getTorrentInfo).mockRejectedValue(error);

			await handleSelectFilesInRd(rdKey, torrentId);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('File selection failed'),
				'select-files'
			);
		});

		it('should use bare mode when specified', async () => {
			const torrentId = 'rd:111';
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: '111',
				files: [{ id: 1, path: 'video.mkv', bytes: 1000000 }],
			} as any);
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			await handleSelectFilesInRd(rdKey, torrentId, true);

			expect(getTorrentInfo).toHaveBeenCalledWith(rdKey, '111', true);
			expect(selectFiles).toHaveBeenCalledWith(rdKey, '111', ['1'], true);
		});
	});

	describe('handleReinsertTorrentinRd', () => {
		const rdKey = 'test-rd-key';
		const mockTorrent: UserTorrent = {
			id: 'rd:old123',
			hash: 'test-hash',
			filename: 'test.mkv',
			title: 'Test Movie',
			bytes: 1000000,
			progress: 100,
			status: UserTorrentStatus.finished,
			serviceStatus: 'downloaded',
			added: new Date(),
			mediaType: 'movie',
			links: [],
			selectedFiles: [],
			seeders: 10,
			speed: 0,
		};

		it('should reinsert torrent and preserve file selection', async () => {
			// Mock fetching current torrent info
			vi.mocked(getTorrentInfo).mockResolvedValueOnce({
				id: 'old123',
				files: [
					{ id: 1, path: 'video1.mkv', selected: 1, bytes: 500000 },
					{ id: 2, path: 'video2.mkv', selected: 0, bytes: 300000 },
					{ id: 3, path: 'video3.mkv', selected: 1, bytes: 200000 },
				],
			} as any);

			// Mock adding new torrent
			vi.mocked(addHashAsMagnet).mockResolvedValue('new456');
			vi.mocked(selectFiles).mockResolvedValue({} as any);

			// Mock checking new torrent progress
			vi.mocked(getTorrentInfo).mockResolvedValueOnce({
				id: 'new456',
				status: 'downloaded',
				progress: 100,
			} as any);

			vi.mocked(handleDeleteRdTorrent).mockResolvedValue(true);

			await handleReinsertTorrentinRd(rdKey, mockTorrent, false);

			expect(getTorrentInfo).toHaveBeenCalledWith(rdKey, 'old123');
			expect(addHashAsMagnet).toHaveBeenCalledWith(rdKey, 'test-hash');
			expect(selectFiles).toHaveBeenCalledWith(rdKey, 'new456', ['1', '3']);
			expect(handleDeleteRdTorrent).toHaveBeenCalledWith(rdKey, 'rd:old123', true);
			expect(toast.success).toHaveBeenCalledWith(
				'Torrent reinserted (rd:old123 -> new456).',
				expect.any(Object)
			);
		});

		it('should use provided selectedFileIds', async () => {
			const selectedFileIds = ['5', '7', '9'];
			vi.mocked(addHashAsMagnet).mockResolvedValue('new789');
			vi.mocked(selectFiles).mockResolvedValue({} as any);
			vi.mocked(getTorrentInfo).mockResolvedValue({
				id: 'new789',
				status: 'downloaded',
				progress: 100,
			} as any);
			vi.mocked(handleDeleteRdTorrent).mockResolvedValue(true);

			await handleReinsertTorrentinRd(rdKey, mockTorrent, false, selectedFileIds);

			expect(selectFiles).toHaveBeenCalledWith(rdKey, 'new789', selectedFileIds);
		});

		it('should handle torrent not ready when forceDeleteOld is false', async () => {
			vi.mocked(getTorrentInfo).mockResolvedValueOnce({
				id: 'old123',
				files: [],
			} as any);
			vi.mocked(addHashAsMagnet).mockResolvedValue('new111');
			vi.mocked(getTorrentInfo).mockResolvedValueOnce({
				id: 'new111',
				files: [],
			} as any);
			vi.mocked(getTorrentInfo).mockResolvedValueOnce({
				id: 'new111',
				status: 'downloading',
				progress: 50,
			} as any);

			await handleReinsertTorrentinRd(rdKey, mockTorrent, false);

			expect(handleDeleteRdTorrent).not.toHaveBeenCalled();
			expect(toast.success).toHaveBeenCalledWith(
				'Torrent reinserted (new111) but still processing.',
				expect.any(Object)
			);
		});

		it('should force delete when forceDeleteOld is true', async () => {
			vi.mocked(getTorrentInfo).mockResolvedValueOnce({
				id: 'old123',
				files: [],
			} as any);
			vi.mocked(addHashAsMagnet).mockResolvedValue('new222');
			vi.mocked(getTorrentInfo).mockResolvedValueOnce({
				id: 'new222',
				files: [],
			} as any);
			vi.mocked(handleDeleteRdTorrent).mockResolvedValue(true);

			await handleReinsertTorrentinRd(rdKey, mockTorrent, true);

			expect(handleDeleteRdTorrent).toHaveBeenCalledWith(rdKey, 'rd:old123', true);
		});

		it('should handle errors and rethrow', async () => {
			const error = new Error('Failed to add magnet');
			vi.mocked(getTorrentInfo).mockResolvedValueOnce({
				id: 'old123',
				files: [],
			} as any);
			vi.mocked(addHashAsMagnet).mockRejectedValue(error);

			await expect(handleReinsertTorrentinRd(rdKey, mockTorrent, false)).rejects.toThrow(
				error
			);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to reinsert torrent'),
				expect.any(Object)
			);
		});
	});

	describe('handleAddAsMagnetInAd', () => {
		const adKey = 'test-ad-key';
		const hash = 'test-hash';

		it('should successfully add magnet to AllDebrid', async () => {
			vi.mocked(uploadMagnetAd).mockResolvedValue({
				magnet: `magnet:?xt=urn:btih:${hash}`,
				id: 123,
				ready: true,
			} as any);
			vi.mocked(isAdMagnetInstant).mockReturnValue(true);
			vi.mocked(getMagnetStatusAd).mockResolvedValue({
				id: 123,
				filename: 'test.mkv',
				size: 1000000,
				status: 'Ready',
				statusCode: 4,
			} as any);

			const callback = vi.fn();
			await handleAddAsMagnetInAd(adKey, hash, callback);

			expect(uploadMagnetAd).toHaveBeenCalledWith(adKey, hash);
			expect(callback).toHaveBeenCalled();
			expect(toast.success).toHaveBeenCalledWith(
				'Torrent cached and available.',
				expect.any(Object)
			);
		});

		it('should handle upload errors gracefully', async () => {
			vi.mocked(uploadMagnetAd).mockResolvedValue({
				magnet: `magnet:?xt=urn:btih:${hash}`,
				error: {
					code: 'NO_SERVER',
					message: 'file not available due to no peer',
				},
			} as any);

			const callback = vi.fn();
			await handleAddAsMagnetInAd(adKey, hash, callback);

			expect(uploadMagnetAd).toHaveBeenCalledWith(adKey, hash);
			// Callback should be called with null for not-available errors
			expect(callback).toHaveBeenCalledWith(null);
		});

		it('should handle non-availability errors', async () => {
			vi.mocked(uploadMagnetAd).mockResolvedValue({
				magnet: `magnet:?xt=urn:btih:${hash}`,
				error: {
					code: 'INVALID_MAGNET',
					message: 'Invalid magnet',
				},
			} as any);

			await expect(handleAddAsMagnetInAd(adKey, hash)).rejects.toThrow();
			expect(toast.error).toHaveBeenCalledWith('Failed to add hash. Try again.');
		});
	});

	describe('handleAddMultipleHashesInAd', () => {
		const adKey = 'test-ad-key';
		const hashes = ['hash1', 'hash2', 'hash3'];

		it('should successfully add multiple hashes to AllDebrid', async () => {
			vi.mocked(uploadMagnet).mockResolvedValue({
				magnets: [
					{ id: '1', error: null },
					{ id: '2', error: null },
					{ id: '3', error: null },
				],
			} as any);

			const callback = vi.fn();
			await handleAddMultipleHashesInAd(adKey, hashes, callback);

			expect(uploadMagnet).toHaveBeenCalledWith(adKey, hashes);
			expect(callback).toHaveBeenCalled();
			expect(toast).toHaveBeenCalledWith('Added 3 hashes.', expect.any(Object));
		});

		it('should handle errors gracefully', async () => {
			vi.mocked(uploadMagnet).mockRejectedValue(new Error('Network error'));

			await handleAddMultipleHashesInAd(adKey, hashes);

			expect(toast.error).toHaveBeenCalledWith('Failed to add hash. Try again.');
		});
	});

	describe('handleRestartTorrent', () => {
		const adKey = 'test-ad-key';
		const torrentId = 'ad:123';

		it('should successfully restart torrent', async () => {
			vi.mocked(restartMagnet).mockResolvedValue({} as any);

			await handleRestartTorrent(adKey, torrentId);

			expect(restartMagnet).toHaveBeenCalledWith(adKey, '123');
			expect(toast.success).toHaveBeenCalledWith(
				'Torrent restarted (ad:123).',
				expect.any(Object)
			);
		});

		it('should handle errors and rethrow', async () => {
			const error = new Error('Failed to restart');
			vi.mocked(restartMagnet).mockRejectedValue(error);

			await expect(handleRestartTorrent(adKey, torrentId)).rejects.toThrow(error);

			expect(toast.error).toHaveBeenCalledWith(
				'Failed to restart torrent (ad:123).',
				expect.any(Object)
			);
		});
	});

	describe('handleAddAsMagnetInTb', () => {
		const tbKey = 'test-tb-key';
		const hash = 'test-hash';

		it('should successfully add magnet to TorBox', async () => {
			const mockTorrentInfo: TorBoxTorrentInfo = {
				id: 123,
				name: 'Test Torrent',
				size: 1000000,
				progress: 100,
				download_state: 'finished',
				seeds: 10,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'test-hash',
				files: [],
			} as any;

			const mockUserTorrent: UserTorrent = {
				id: 'tb:123',
				filename: 'Test Torrent',
				title: 'Test Torrent',
				bytes: 1000000,
				progress: 100,
				status: UserTorrentStatus.finished,
				serviceStatus: 'finished',
				added: new Date('2024-01-01T00:00:00Z'),
				mediaType: 'movie',
				links: [],
				selectedFiles: [],
				seeders: 10,
				speed: 0,
				hash: 'test-hash',
			};

			vi.mocked(createTorrent).mockResolvedValue({
				data: { torrent_id: 123 },
			} as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				data: mockTorrentInfo,
			} as any);
			vi.mocked(convertToTbUserTorrent).mockReturnValue(mockUserTorrent);

			const callback = vi.fn();
			await handleAddAsMagnetInTb(tbKey, hash, callback);

			expect(createTorrent).toHaveBeenCalledWith(tbKey, {
				magnet: `magnet:?xt=urn:btih:${hash}`,
			});
			expect(getTorrentList).toHaveBeenCalledWith(tbKey, { id: 123 });
			expect(callback).toHaveBeenCalledWith(mockUserTorrent);
			expect(toast.success).toHaveBeenCalledWith('Torrent added.', expect.any(Object));
		});

		it('should handle queued torrents', async () => {
			const mockTorrentInfo: TorBoxTorrentInfo = {
				id: 456,
				name: 'Queued Torrent',
				size: 2000000,
				progress: 0,
				download_state: 'queued',
				seeds: 5,
				download_speed: 0,
				created_at: '2024-01-02T00:00:00Z',
				hash: 'queued-hash',
				files: [],
			} as any;

			vi.mocked(createTorrent).mockResolvedValue({
				data: { queued_id: 456 },
			} as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				data: mockTorrentInfo,
			} as any);
			vi.mocked(convertToTbUserTorrent).mockReturnValue({} as UserTorrent);

			await handleAddAsMagnetInTb(tbKey, hash);

			expect(createTorrent).toHaveBeenCalledWith(tbKey, {
				magnet: `magnet:?xt=urn:btih:${hash}`,
			});
			expect(toast.success).toHaveBeenCalledWith('Torrent added.', expect.any(Object));
		});

		it('should handle no ID returned', async () => {
			vi.mocked(createTorrent).mockResolvedValue({
				data: {},
			} as any);

			await handleAddAsMagnetInTb(tbKey, hash);

			expect(toast.error).toHaveBeenCalledWith(
				'Torrent added without an ID.',
				expect.any(Object)
			);
		});

		it('should handle errors and rethrow', async () => {
			const error = new Error('Failed to create torrent');
			vi.mocked(createTorrent).mockRejectedValue(error);

			await expect(handleAddAsMagnetInTb(tbKey, hash)).rejects.toThrow(error);

			expect(toast.error).toHaveBeenCalledWith('Failed to add torrent.', expect.any(Object));
		});
	});
});
