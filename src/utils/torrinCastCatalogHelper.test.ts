import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository', () => ({
	repository: {
		getTorrinCastProfile: vi.fn(),
	},
}));

vi.mock('@/services/torrin', () => ({
	getTorrinTorrentsList: vi.fn(),
	getTorrinTorrentInfo: vi.fn(),
}));

import { repository as db } from '@/services/repository';
import { getTorrinTorrentInfo, getTorrinTorrentsList } from '@/services/torrin';
import { PAGE_SIZE, getTorrinDMMLibrary, getTorrinDMMTorrent } from './torrinCastCatalogHelper';

const profile = { baseUrl: 'https://tr.test', apiKey: 'key' };

describe('torrinCastCatalogHelper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DMM_ORIGIN = 'https://debridmediamanager.com';
	});

	describe('PAGE_SIZE', () => {
		it('is 12', () => {
			expect(PAGE_SIZE).toBe(12);
		});
	});

	describe('getTorrinDMMLibrary', () => {
		it('returns 401 when no profile found', async () => {
			vi.mocked(db.getTorrinCastProfile).mockResolvedValue(null);
			const result = await getTorrinDMMLibrary('user1', 1);
			expect(result).toEqual({
				error: 'Go to DMM and connect your Torrin instance',
				status: 401,
			});
		});

		it('returns 401 when profile lookup throws', async () => {
			vi.mocked(db.getTorrinCastProfile).mockRejectedValue(new Error('DB error'));
			const result = await getTorrinDMMLibrary('user1', 1);
			expect(result.status).toBe(401);
		});

		it('returns metas mapped from the torrent list', async () => {
			vi.mocked(db.getTorrinCastProfile).mockResolvedValue(profile as any);
			vi.mocked(getTorrinTorrentsList).mockResolvedValue({
				data: [
					{ id: 'a1', filename: 'Movie A' },
					{ id: 'b2', filename: 'Movie B' },
				],
				totalCount: 2,
			} as any);

			const result = await getTorrinDMMLibrary('user1', 1);

			expect(result.status).toBe(200);
			expect(result.data!.metas).toEqual([
				{ id: 'dmm-tr:a1', name: 'Movie A', type: 'other' },
				{ id: 'dmm-tr:b2', name: 'Movie B', type: 'other' },
			]);
		});

		it('sets hasMore true when a full page is returned', async () => {
			const data = Array.from({ length: PAGE_SIZE }, (_, i) => ({
				id: `t${i}`,
				filename: `T${i}`,
			}));
			vi.mocked(db.getTorrinCastProfile).mockResolvedValue(profile as any);
			vi.mocked(getTorrinTorrentsList).mockResolvedValue({ data, totalCount: 100 } as any);

			const result = await getTorrinDMMLibrary('user1', 1);
			expect(result.data!.hasMore).toBe(true);
		});

		it('sets hasMore false for a partial page', async () => {
			vi.mocked(db.getTorrinCastProfile).mockResolvedValue(profile as any);
			vi.mocked(getTorrinTorrentsList).mockResolvedValue({
				data: [{ id: 'x', filename: 'Only' }],
				totalCount: 1,
			} as any);

			const result = await getTorrinDMMLibrary('user1', 1);
			expect(result.data!.hasMore).toBe(false);
		});

		it('passes page + page size to the list call', async () => {
			vi.mocked(db.getTorrinCastProfile).mockResolvedValue(profile as any);
			vi.mocked(getTorrinTorrentsList).mockResolvedValue({ data: [], totalCount: 0 } as any);

			await getTorrinDMMLibrary('user1', 3);
			expect(getTorrinTorrentsList).toHaveBeenCalledWith(
				'https://tr.test',
				'key',
				PAGE_SIZE,
				3
			);
		});
	});

	describe('getTorrinDMMTorrent', () => {
		it('returns 401 when no profile found', async () => {
			vi.mocked(db.getTorrinCastProfile).mockResolvedValue(null);
			const result = await getTorrinDMMTorrent('user1', 'abc');
			expect(result.status).toBe(401);
		});

		it('returns torrent meta with selected files as videos', async () => {
			vi.mocked(db.getTorrinCastProfile).mockResolvedValue(profile as any);
			vi.mocked(getTorrinTorrentInfo).mockResolvedValue({
				id: 'abc',
				filename: 'Test Torrent',
				files: [
					{ id: 1, path: 'a/file1.mkv', bytes: 1073741824, selected: 1 },
					{ id: 2, path: 'b/file2.mp4', bytes: 2147483648, selected: 1 },
				],
				links: ['https://tr/l1', 'https://tr/l2'],
			} as any);

			const result = await getTorrinDMMTorrent('user1', 'abc');

			expect(result.status).toBe(200);
			expect(result.data!.meta.id).toBe('dmm-tr:abc');
			expect(result.data!.meta.type).toBe('other');
			expect(result.data!.meta.videos).toHaveLength(2);
			expect(result.data!.meta.videos[0].streams[0].url).toContain(
				'/api/stremio-tr/user1/play/'
			);
		});

		it('skips files without a matching link', async () => {
			vi.mocked(db.getTorrinCastProfile).mockResolvedValue(profile as any);
			vi.mocked(getTorrinTorrentInfo).mockResolvedValue({
				id: 'abc',
				filename: 'Partial',
				files: [
					{ id: 1, path: 'file1.mkv', bytes: 100, selected: 1 },
					{ id: 2, path: 'file2.mkv', bytes: 100, selected: 1 },
				],
				links: ['https://tr/l1'],
			} as any);

			const result = await getTorrinDMMTorrent('user1', 'abc');
			expect(result.data!.meta.videos).toHaveLength(1);
		});

		it('sorts videos by title', async () => {
			vi.mocked(db.getTorrinCastProfile).mockResolvedValue(profile as any);
			vi.mocked(getTorrinTorrentInfo).mockResolvedValue({
				id: 'abc',
				filename: 'Show',
				files: [
					{ id: 2, path: 'z-file.mkv', bytes: 100, selected: 1 },
					{ id: 1, path: 'a-file.mkv', bytes: 100, selected: 1 },
				],
				links: ['https://tr/l1', 'https://tr/l2'],
			} as any);

			const result = await getTorrinDMMTorrent('user1', 'abc');
			const titles = result.data!.meta.videos.map((v: any) => v.title);
			expect(titles[0]).toMatch(/^a-file/);
			expect(titles[1]).toMatch(/^z-file/);
		});
	});
});
