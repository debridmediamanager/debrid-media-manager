import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository', () => ({
	repository: {
		getTorBoxCastProfile: vi.fn(),
	},
}));

vi.mock('@/services/torbox', () => ({
	getTorrentList: vi.fn(),
}));

import { repository as db } from '@/services/repository';
import { getTorrentList } from '@/services/torbox';
import { getTorBoxDMMLibrary, getTorBoxDMMTorrent, PAGE_SIZE } from './torboxCastCatalogHelper';

describe('torboxCastCatalogHelper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DMM_ORIGIN = 'https://debridmediamanager.com';
	});

	describe('PAGE_SIZE', () => {
		it('is 12', () => {
			expect(PAGE_SIZE).toBe(12);
		});
	});

	describe('getTorBoxDMMLibrary', () => {
		it('returns 401 when no profile found', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue(null);

			const result = await getTorBoxDMMLibrary('user1', 1);

			expect(result).toEqual({
				error: 'Go to DMM and connect your TorBox account',
				status: 401,
			});
		});

		it('returns 401 when profile lookup throws', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockRejectedValue(new Error('DB error'));

			const result = await getTorBoxDMMLibrary('user1', 1);

			expect(result).toEqual({
				error: 'Go to DMM and connect your TorBox account',
				status: 401,
			});
		});

		it('returns 500 when torrent list fails', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({ success: false, data: null } as any);

			const result = await getTorBoxDMMLibrary('user1', 1);

			expect(result).toEqual({
				error: 'Failed to get user torrents list',
				status: 500,
			});
		});

		it('returns metas for torrent array', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: [
					{ id: 1, name: 'Movie A' },
					{ id: 2, name: 'Movie B' },
				],
			} as any);

			const result = await getTorBoxDMMLibrary('user1', 1);

			expect(result.status).toBe(200);
			expect(result.data!.metas).toEqual([
				{ id: 'dmm-tb:1', name: 'Movie A', type: 'other' },
				{ id: 'dmm-tb:2', name: 'Movie B', type: 'other' },
			]);
		});

		it('wraps single torrent object in array', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: { id: 99, name: 'Single' },
			} as any);

			const result = await getTorBoxDMMLibrary('user1', 1);

			expect(result.data!.metas).toHaveLength(1);
			expect(result.data!.metas[0].id).toBe('dmm-tb:99');
		});

		it('sets hasMore true when results equal PAGE_SIZE', async () => {
			const torrents = Array.from({ length: PAGE_SIZE }, (_, i) => ({
				id: i,
				name: `T${i}`,
			}));
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: torrents,
			} as any);

			const result = await getTorBoxDMMLibrary('user1', 1);

			expect(result.data.hasMore).toBe(true);
		});

		it('sets hasMore false when results less than PAGE_SIZE', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: [{ id: 1, name: 'Only' }],
			} as any);

			const result = await getTorBoxDMMLibrary('user1', 1);

			expect(result.data.hasMore).toBe(false);
		});

		it('calculates correct offset from page number', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: [],
			} as any);

			await getTorBoxDMMLibrary('user1', 3);

			expect(getTorrentList).toHaveBeenCalledWith('key', {
				offset: (3 - 1) * PAGE_SIZE,
				limit: PAGE_SIZE,
			});
		});
	});

	describe('getTorBoxDMMTorrent', () => {
		it('returns 401 when no profile found', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue(null);

			const result = await getTorBoxDMMTorrent('user1', '123');

			expect(result).toEqual({
				error: 'Go to DMM and connect your TorBox account',
				status: 401,
			});
		});

		it('returns 400 for invalid torrent ID', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);

			const result = await getTorBoxDMMTorrent('user1', 'not-a-number');

			expect(result).toEqual({
				error: 'Invalid torrent ID',
				status: 400,
			});
		});

		it('returns 500 when torrent list fails', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: false,
				data: null,
			} as any);

			const result = await getTorBoxDMMTorrent('user1', '123');

			expect(result).toEqual({
				error: 'Failed to get torrent info',
				status: 500,
			});
		});

		it('returns 404 when torrent not found in results', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: [],
			} as any);

			const result = await getTorBoxDMMTorrent('user1', '123');

			expect(result).toEqual({
				error: 'Torrent not found',
				status: 404,
			});
		});

		it('returns torrent meta with files as videos', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: {
					id: 42,
					name: 'Test Torrent',
					files: [
						{ id: 1, name: 'file1.mkv', short_name: 'file1', size: 1073741824 },
						{ id: 2, name: 'file2.mp4', short_name: 'file2', size: 2147483648 },
					],
				},
			} as any);

			const result = await getTorBoxDMMTorrent('user1', '42');

			expect(result.status).toBe(200);
			expect(result.data!.meta.id).toBe('dmm-tb:42');
			expect(result.data!.meta.type).toBe('other');
			expect(result.data!.meta.videos).toHaveLength(2);
			expect(result.data!.meta.videos[0].streams[0].url).toContain(
				'/api/stremio-tb/user1/play/42:'
			);
		});

		it('handles torrent with no files', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: { id: 10, name: 'Empty', files: [] },
			} as any);

			const result = await getTorBoxDMMTorrent('user1', '10');

			expect(result.status).toBe(200);
			expect(result.data!.meta.videos).toHaveLength(0);
		});

		it('handles single torrent object (not array)', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: {
					id: 5,
					name: 'Single',
					files: [{ id: 1, name: 'video.mkv', short_name: 'video', size: 500000000 }],
				},
			} as any);

			const result = await getTorBoxDMMTorrent('user1', '5');

			expect(result.status).toBe(200);
			expect(result.data!.meta.name).toContain('Single');
		});

		it('sorts videos by title', async () => {
			vi.mocked(db.getTorBoxCastProfile).mockResolvedValue({ apiKey: 'key' } as any);
			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: {
					id: 1,
					name: 'Show',
					files: [
						{ id: 2, name: 'z-file.mkv', short_name: 'z-file', size: 100 },
						{ id: 1, name: 'a-file.mkv', short_name: 'a-file', size: 100 },
					],
				},
			} as any);

			const result = await getTorBoxDMMTorrent('user1', '1');

			const titles = result.data!.meta.videos.map((v: any) => v.title);
			expect(titles[0]).toMatch(/^a-file/);
			expect(titles[1]).toMatch(/^z-file/);
		});
	});
});
