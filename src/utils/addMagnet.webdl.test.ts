import { TorBoxRateLimitError } from '@/services/torbox';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAddMultipleWebDownloadsInTb, handleAddWebDownloadInTb } from './addMagnet';

const mocks = vi.hoisted(() => ({
	createWebDownload: vi.fn(),
	getWebDownloadList: vi.fn(),
}));

vi.mock('@/services/torbox', async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		createWebDownload: mocks.createWebDownload,
		getWebDownloadList: mocks.getWebDownloadList,
	};
});

vi.mock('@/services/realDebrid');
vi.mock('@/services/allDebrid');
vi.mock('./deleteTorrent');

vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		promise: vi.fn(),
	}),
}));

vi.mock('@/utils/delay', () => ({ delay: vi.fn().mockResolvedValue(undefined) }));

const webDownload = {
	id: 42,
	hash: 'd41d8cd98f00b204e9800998ecf8427e',
	name: 'Direct Movie 2021.mkv',
	size: 1000,
	download_state: 'completed',
	download_finished: true,
	progress: 100,
	download_speed: 0,
	created_at: '2024-01-01T00:00:00Z',
	files: [{ id: 0, name: 'Direct Movie 2021.mkv', size: 1000 }],
};

describe('TorBox web downloads', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('handleAddWebDownloadInTb', () => {
		it('sends the link to TorBox and reports success', async () => {
			mocks.createWebDownload.mockResolvedValue({
				success: true,
				data: { webdownload_id: 42 },
			});

			await handleAddWebDownloadInTb('tb-key', 'https://example.com/movie.mkv');

			expect(mocks.createWebDownload).toHaveBeenCalledWith('tb-key', {
				link: 'https://example.com/movie.mkv',
			});
			expect(toast.success).toHaveBeenCalledWith('Web download added.', expect.any(Object));
		});

		it('hands the created item back to the caller as a library row', async () => {
			mocks.createWebDownload.mockResolvedValue({
				success: true,
				data: { webdownload_id: 42 },
			});
			mocks.getWebDownloadList.mockResolvedValue({ success: true, data: webDownload });
			const callback = vi.fn();

			await handleAddWebDownloadInTb('tb-key', 'https://example.com/movie.mkv', callback);

			expect(mocks.getWebDownloadList).toHaveBeenCalledWith('tb-key', { id: 42 });
			expect(callback).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'tb:w42', filename: 'Direct Movie 2021.mkv' })
			);
		});

		it('accepts a queued id when TorBox defers the download', async () => {
			mocks.createWebDownload.mockResolvedValue({ success: true, data: { queued_id: 7 } });

			await handleAddWebDownloadInTb('tb-key', 'https://example.com/movie.mkv');

			expect(toast.success).toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
		});

		it('reports when TorBox returns no id', async () => {
			mocks.createWebDownload.mockResolvedValue({ success: true, data: {} });

			await handleAddWebDownloadInTb('tb-key', 'https://example.com/movie.mkv');

			expect(toast.error).toHaveBeenCalledWith(
				'Web download added without an ID.',
				expect.any(Object)
			);
		});

		it('rethrows and reports API failures', async () => {
			mocks.createWebDownload.mockRejectedValue(new Error('hoster unsupported'));

			await expect(
				handleAddWebDownloadInTb('tb-key', 'https://example.com/movie.mkv')
			).rejects.toThrow('hoster unsupported');
			expect(toast.error).toHaveBeenCalledWith(
				'Failed to add web download.',
				expect.any(Object)
			);
		});
	});

	describe('handleAddMultipleWebDownloadsInTb', () => {
		it('adds every link and refreshes once', async () => {
			mocks.createWebDownload.mockResolvedValue({
				success: true,
				data: { webdownload_id: 1 },
			});
			const callback = vi.fn();

			await handleAddMultipleWebDownloadsInTb(
				'tb-key',
				['https://example.com/a.mkv', 'https://example.com/b.mkv'],
				callback
			);

			expect(mocks.createWebDownload).toHaveBeenCalledTimes(2);
			expect(callback).toHaveBeenCalledTimes(1);
			expect(toast).toHaveBeenCalledWith(
				'Added 2 web downloads to TorBox.',
				expect.any(Object)
			);
		});

		it('keeps going past a single failing link', async () => {
			mocks.createWebDownload
				.mockRejectedValueOnce(new Error('bad link'))
				.mockResolvedValueOnce({ success: true, data: { webdownload_id: 2 } });

			await handleAddMultipleWebDownloadsInTb('tb-key', [
				'https://example.com/a.mkv',
				'https://example.com/b.mkv',
			]);

			expect(mocks.createWebDownload).toHaveBeenCalledTimes(2);
			expect(toast).toHaveBeenCalledWith(
				'Added 1 web download to TorBox.',
				expect.any(Object)
			);
		});

		it('stops at a rate limit and reports what got through', async () => {
			mocks.createWebDownload
				.mockResolvedValueOnce({ success: true, data: { webdownload_id: 1 } })
				.mockRejectedValueOnce(new TorBoxRateLimitError());

			await handleAddMultipleWebDownloadsInTb('tb-key', [
				'https://example.com/a.mkv',
				'https://example.com/b.mkv',
				'https://example.com/c.mkv',
			]);

			expect(mocks.createWebDownload).toHaveBeenCalledTimes(2);
			expect(toast).toHaveBeenCalledWith(
				'Added 1 web download before rate limit.',
				expect.any(Object)
			);
		});
	});
});
