import { addHashAsMagnet, getTorrentInfo, selectFiles } from '@/services/realDebrid';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { handleReinsertTorrentinRd } from './addMagnet';
import { handleDeleteRdTorrent } from './deleteTorrent';

// Mock dependencies
vi.mock('@/services/realDebrid');
vi.mock('./deleteTorrent');
vi.mock('react-hot-toast');

const mockGetTorrentInfo = getTorrentInfo as MockedFunction<typeof getTorrentInfo>;
const mockAddHashAsMagnet = addHashAsMagnet as MockedFunction<typeof addHashAsMagnet>;
const mockSelectFiles = selectFiles as MockedFunction<typeof selectFiles>;
const mockHandleDeleteRdTorrent = handleDeleteRdTorrent as MockedFunction<
	typeof handleDeleteRdTorrent
>;
const mockToast = {
	success: vi.fn(),
	error: vi.fn(),
};
(toast as any).success = mockToast.success;
(toast as any).error = mockToast.error;

describe('handleReinsertTorrentinRd', () => {
	const mockRdKey = 'test-rd-key';
	const mockTorrent: UserTorrent = {
		id: 'rd:123',
		hash: 'abc123hash',
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

	beforeEach(() => {
		vi.resetAllMocks();
		mockToast.success = vi.fn();
		mockToast.error = vi.fn();
		(toast as any).success = mockToast.success;
		(toast as any).error = mockToast.error;
	});

	describe('File Selection Preservation', () => {
		it('should preserve existing file selection when no selectedFileIds provided', async () => {
			// Mock current torrent info with selected files
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '123',
				status: 'downloaded',
				progress: 100,
				files: [
					{ id: 1, path: 'video1.mkv', selected: 1, bytes: 500000 },
					{ id: 2, path: 'video2.mkv', selected: 1, bytes: 300000 },
					{ id: 3, path: 'subtitle.srt', selected: 0, bytes: 1000 },
				],
				links: ['link1', 'link2'],
			} as any);

			// Mock successful reinsert
			mockAddHashAsMagnet.mockResolvedValueOnce('456');
			mockSelectFiles.mockResolvedValueOnce({} as any);
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '456',
				status: 'downloaded',
				progress: 100,
			} as any);
			mockHandleDeleteRdTorrent.mockResolvedValueOnce(true);

			await handleReinsertTorrentinRd(mockRdKey, mockTorrent, true);

			// Verify it fetched current info
			expect(mockGetTorrentInfo).toHaveBeenCalledWith(mockRdKey, '123');

			// Verify it selected only the previously selected files
			expect(mockSelectFiles).toHaveBeenCalledWith(mockRdKey, '456', ['1', '2']);

			// Verify success message
			expect(mockToast.success).toHaveBeenCalledWith(
				expect.stringContaining('Torrent reinserted'),
				expect.any(Object)
			);
		});

		it('should use provided selectedFileIds when explicitly passed', async () => {
			const customSelectedIds = ['5', '7', '9'];

			// Should NOT fetch current info when IDs are provided
			mockAddHashAsMagnet.mockResolvedValueOnce('456');
			mockSelectFiles.mockResolvedValueOnce({} as any);
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '456',
				status: 'downloaded',
				progress: 100,
			} as any);
			mockHandleDeleteRdTorrent.mockResolvedValueOnce(true);

			await handleReinsertTorrentinRd(mockRdKey, mockTorrent, true, customSelectedIds);

			// Verify it did NOT fetch current info (only called once for progress check)
			expect(mockGetTorrentInfo).toHaveBeenCalledTimes(1);
			expect(mockGetTorrentInfo).toHaveBeenCalledWith(mockRdKey, '456');

			// Verify it used the provided file IDs
			expect(mockSelectFiles).toHaveBeenCalledWith(mockRdKey, '456', customSelectedIds);
		});

		it('should fall back to default video selection when no files were previously selected', async () => {
			// Mock current torrent info with NO selected files
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '123',
				status: 'downloaded',
				progress: 100,
				files: [
					{ id: 1, path: 'video1.mkv', selected: 0, bytes: 500000 },
					{ id: 2, path: 'video2.mkv', selected: 0, bytes: 300000 },
				],
				links: [],
			} as any);

			// Mock successful reinsert
			mockAddHashAsMagnet.mockResolvedValueOnce('456');

			// Mock getTorrentInfo for handleSelectFilesInRd
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '456',
				files: [
					{ id: 1, path: 'video1.mkv', selected: 0, bytes: 500000 },
					{ id: 2, path: 'video2.mkv', selected: 0, bytes: 300000 },
				],
			} as any);

			mockSelectFiles.mockResolvedValueOnce({} as any);

			// Mock final progress check
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '456',
				status: 'downloaded',
				progress: 100,
			} as any);

			mockHandleDeleteRdTorrent.mockResolvedValueOnce(true);

			await handleReinsertTorrentinRd(mockRdKey, mockTorrent, true);

			// Verify it tried to select video files (handleSelectFilesInRd was called)
			expect(mockGetTorrentInfo).toHaveBeenCalledWith(mockRdKey, '123'); // Initial fetch
			expect(mockGetTorrentInfo).toHaveBeenCalledWith(mockRdKey, '456', false); // handleSelectFilesInRd
			expect(mockSelectFiles).toHaveBeenCalled();
		});
	});

	describe('Error Handling', () => {
		it('should handle errors when fetching current torrent info fails', async () => {
			const error = new Error('Failed to fetch torrent info');
			mockGetTorrentInfo.mockRejectedValueOnce(error);

			await expect(handleReinsertTorrentinRd(mockRdKey, mockTorrent, true)).rejects.toThrow(
				error
			);

			expect(mockToast.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to reinsert torrent'),
				expect.any(Object)
			);
		});

		it('should handle errors when adding magnet fails', async () => {
			// Mock successful info fetch
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '123',
				files: [{ id: 1, path: 'video1.mkv', selected: 1, bytes: 500000 }],
			} as any);

			const error = new Error('Failed to add magnet');
			mockAddHashAsMagnet.mockRejectedValueOnce(error);

			await expect(handleReinsertTorrentinRd(mockRdKey, mockTorrent, true)).rejects.toThrow(
				error
			);

			expect(mockToast.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to reinsert torrent'),
				expect.any(Object)
			);
		});

		it('should handle errors when selecting files fails', async () => {
			// Mock successful info fetch
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '123',
				files: [{ id: 1, path: 'video1.mkv', selected: 1, bytes: 500000 }],
			} as any);

			mockAddHashAsMagnet.mockResolvedValueOnce('456');

			const error = new Error('Failed to select files');
			mockSelectFiles.mockRejectedValueOnce(error);

			await expect(handleReinsertTorrentinRd(mockRdKey, mockTorrent, true)).rejects.toThrow(
				error
			);

			expect(mockToast.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to reinsert torrent'),
				expect.any(Object)
			);
		});
	});

	describe('Force Delete Behavior', () => {
		it('should wait for torrent to be ready when forceDeleteOld is false', async () => {
			// Mock current info
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '123',
				files: [{ id: 1, path: 'video1.mkv', selected: 1, bytes: 500000 }],
			} as any);

			mockAddHashAsMagnet.mockResolvedValueOnce('456');
			mockSelectFiles.mockResolvedValueOnce({} as any);

			// Mock torrent not ready
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '456',
				status: 'downloading',
				progress: 50,
			} as any);

			await handleReinsertTorrentinRd(mockRdKey, mockTorrent, false);

			// Should not delete old torrent
			expect(mockHandleDeleteRdTorrent).not.toHaveBeenCalled();

			// Should show "not ready" message
			expect(mockToast.success).toHaveBeenCalledWith(
				expect.stringContaining('but still processing.'),
				expect.any(Object)
			);
		});

		it('should delete old torrent immediately when forceDeleteOld is true', async () => {
			// Mock current info
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '123',
				files: [{ id: 1, path: 'video1.mkv', selected: 1, bytes: 500000 }],
			} as any);

			mockAddHashAsMagnet.mockResolvedValueOnce('456');
			mockSelectFiles.mockResolvedValueOnce({} as any);
			mockHandleDeleteRdTorrent.mockResolvedValueOnce(true);

			await handleReinsertTorrentinRd(mockRdKey, mockTorrent, true);

			// Should delete old torrent without checking progress
			expect(mockHandleDeleteRdTorrent).toHaveBeenCalledWith(mockRdKey, 'rd:123', true);

			// Should NOT check progress when forceDeleteOld is true
			expect(mockGetTorrentInfo).toHaveBeenCalledTimes(1); // Only initial fetch
		});
	});

	describe('Empty Selection Edge Cases', () => {
		it('should handle empty selectedFileIds array as no selection', async () => {
			// Mock current torrent info
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '123',
				files: [
					{ id: 1, path: 'video1.mkv', selected: 1, bytes: 500000 },
					{ id: 2, path: 'video2.mkv', selected: 1, bytes: 300000 },
				],
			} as any);

			mockAddHashAsMagnet.mockResolvedValueOnce('456');
			mockSelectFiles.mockResolvedValueOnce({} as any);
			mockHandleDeleteRdTorrent.mockResolvedValueOnce(true);

			// Pass empty array - should fetch current selection
			await handleReinsertTorrentinRd(mockRdKey, mockTorrent, true, []);

			// Should fetch current info since empty array provided
			expect(mockGetTorrentInfo).toHaveBeenCalledWith(mockRdKey, '123');

			// Should use fetched selection
			expect(mockSelectFiles).toHaveBeenCalledWith(mockRdKey, '456', ['1', '2']);
		});

		it('should handle torrent with no files gracefully', async () => {
			// Mock torrent with no files
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '123',
				files: [],
				links: [],
			} as any);

			mockAddHashAsMagnet.mockResolvedValueOnce('456');

			// Mock for handleSelectFilesInRd
			mockGetTorrentInfo.mockResolvedValueOnce({
				id: '456',
				files: [],
			} as any);

			// selectFiles should not be called since handleSelectFilesInRd will throw
			mockHandleDeleteRdTorrent.mockResolvedValueOnce(true);

			await handleReinsertTorrentinRd(mockRdKey, mockTorrent, true);

			// Should complete without selecting files
			expect(mockSelectFiles).not.toHaveBeenCalled();
			expect(mockHandleDeleteRdTorrent).toHaveBeenCalled();
		});
	});
});
