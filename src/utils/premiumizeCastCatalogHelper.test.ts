import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListFolder, mockItemDetails, mockGetProfile } = vi.hoisted(() => ({
	mockListFolder: vi.fn(),
	mockItemDetails: vi.fn(),
	mockGetProfile: vi.fn(),
}));

vi.mock('@/services/premiumize', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/premiumize')>('@/services/premiumize');
	return {
		...actual,
		listPremiumizeFolder: mockListFolder,
		getPremiumizeItemDetails: mockItemDetails,
	};
});

vi.mock('@/services/repository', () => ({
	repository: { getPremiumizeCastProfile: mockGetProfile },
}));

import {
	getPremiumizeDMMItem,
	getPremiumizeDMMLibrary,
	parsePremiumizeMetaId,
	premiumizeMetaId,
} from './premiumizeCastCatalogHelper';

const root = (extra: any[] = []) => ({
	name: '',
	parent_id: null,
	folder_id: 'root',
	content: [
		{ id: 'f1', name: 'Some.Release.2026.1080p', type: 'folder', created_at: 300 },
		{ id: 'v1', name: 'A.Movie.2026.2160p.mp4', type: 'file', created_at: 200, size: 10 },
		// Not playable: a loose .nzb in the root would be a library tile that plays nothing.
		{ id: 'n1', name: 'Something.nzb', type: 'file', created_at: 400, size: 1 },
		...extra,
	],
});

describe('premiumizeCastCatalogHelper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DMM_ORIGIN = 'https://dmm.test';
		mockGetProfile.mockResolvedValue({ apiKey: 'pm-key' });
	});

	describe('meta ids', () => {
		it('round-trips folder and file ids', () => {
			expect(parsePremiumizeMetaId(premiumizeMetaId('folder', 'abc'))).toEqual({
				kind: 'folder',
				id: 'abc',
			});
			expect(parsePremiumizeMetaId(premiumizeMetaId('file', 'x_-Y'))).toEqual({
				kind: 'file',
				id: 'x_-Y',
			});
		});

		it('rejects another addon’s library id', () => {
			expect(parsePremiumizeMetaId('dmm:ABC123')).toBeNull();
			expect(parsePremiumizeMetaId('dmm-tb:123')).toBeNull();
			expect(parsePremiumizeMetaId('dmm-ad:123')).toBeNull();
		});
	});

	describe('getPremiumizeDMMLibrary', () => {
		it('lists folders and playable root files, newest first', async () => {
			mockListFolder.mockResolvedValue(root());
			const result = await getPremiumizeDMMLibrary('user1', 1);
			if ('error' in result) throw new Error(result.error);

			expect(result.data.metas).toEqual([
				{ id: 'dmm-pm:folder:f1', name: 'Some.Release.2026.1080p', type: 'other' },
				{ id: 'dmm-pm:file:v1', name: 'A.Movie.2026.2160p.mp4', type: 'other' },
			]);
			expect(result.data.hasMore).toBe(false);
		});

		it('pages through the root listing and reports hasMore', async () => {
			const many = Array.from({ length: 20 }, (_, i) => ({
				id: `x${i}`,
				name: `Release.${i}`,
				type: 'folder',
				created_at: 1000 - i,
			}));
			mockListFolder.mockResolvedValue({ ...root([]), content: many });

			const first = await getPremiumizeDMMLibrary('user1', 1);
			if ('error' in first) throw new Error(first.error);
			expect(first.data.metas).toHaveLength(12);
			expect(first.data.metas[0].id).toBe('dmm-pm:folder:x0');
			expect(first.data.hasMore).toBe(true);

			const second = await getPremiumizeDMMLibrary('user1', 2);
			if ('error' in second) throw new Error(second.error);
			expect(second.data.metas).toHaveLength(8);
			expect(second.data.metas[0].id).toBe('dmm-pm:folder:x12');
			expect(second.data.hasMore).toBe(false);
		});

		it('returns 401 when the user has no Premiumize profile', async () => {
			mockGetProfile.mockResolvedValue(null);
			const result = await getPremiumizeDMMLibrary('user1', 1);
			expect(result).toMatchObject({ status: 401 });
		});
	});

	describe('getPremiumizeDMMItem', () => {
		it('flattens a nested release into videos that play through DMM', async () => {
			mockListFolder.mockImplementation(async (_key: string, id: string) => {
				if (id === 'f1') {
					return {
						name: 'Some.Release.2026.1080p',
						content: [
							{ id: 'sub', name: 'Subs', type: 'folder' },
							{ id: 'b', name: 'b.mkv', type: 'file', size: 2 * 1024 ** 3 },
							{ id: 'a', name: 'a.mkv', type: 'file', size: 1024 ** 3 },
							{ id: 'nfo', name: 'release.nfo', type: 'file', size: 10 },
						],
					};
				}
				return {
					name: 'Subs',
					content: [{ id: 's1', name: 'extra.mkv', type: 'file', size: 1024 ** 3 }],
				};
			});

			const result = await getPremiumizeDMMItem('user1', 'folder', 'f1');
			if ('error' in result) throw new Error(result.error);

			const videos = result.data.meta.videos;
			expect(videos.map((v) => v.title.split(' - ')[0])).toEqual([
				'a.mkv',
				'b.mkv',
				'Subs/extra.mkv',
			]);
			// Links are minted at play time, never baked into the meta.
			expect(videos.map((v) => v.streams[0].url)).toEqual([
				'https://dmm.test/api/stremio-pm/user1/play/item/a',
				'https://dmm.test/api/stremio-pm/user1/play/item/b',
				'https://dmm.test/api/stremio-pm/user1/play/item/s1',
			]);
			expect(
				videos.every((v) => v.streams[0].behaviorHints.bingeGroup === 'dmm-pm:folder:f1')
			).toBe(true);
			expect(result.data.meta.name).toBe('DMM PM: Some.Release.2026.1080p - 4.00 GB');
		});

		it('does not lose the files it did read when a subfolder will not list', async () => {
			mockListFolder.mockImplementation(async (_key: string, id: string) => {
				if (id === 'f1') {
					return {
						name: 'Release',
						content: [
							{ id: 'sub', name: 'Subs', type: 'folder' },
							{ id: 'a', name: 'a.mkv', type: 'file', size: 1024 ** 3 },
						],
					};
				}
				throw new Error('folder gone');
			});

			const result = await getPremiumizeDMMItem('user1', 'folder', 'f1');
			if ('error' in result) throw new Error(result.error);
			expect(result.data.meta.videos).toHaveLength(1);
		});

		it('404s a folder holding no video', async () => {
			mockListFolder.mockResolvedValue({
				name: 'Docs',
				content: [{ id: 'n', name: 'readme.txt', type: 'file', size: 1 }],
			});
			const result = await getPremiumizeDMMItem('user1', 'folder', 'f1');
			expect(result).toMatchObject({ status: 404 });
		});

		it('builds a single-video meta for a loose root file', async () => {
			mockItemDetails.mockResolvedValue({
				id: 'v1',
				name: 'A.Movie.2026.2160p.mp4',
				size: 2 * 1024 ** 3,
				type: 'file',
			});
			const result = await getPremiumizeDMMItem('user1', 'file', 'v1');
			if ('error' in result) throw new Error(result.error);

			expect(result.data.meta.name).toBe('DMM PM: A.Movie.2026.2160p.mp4 - 2.00 GB');
			expect(result.data.meta.videos).toHaveLength(1);
			expect(result.data.meta.videos[0].streams[0].url).toBe(
				'https://dmm.test/api/stremio-pm/user1/play/item/v1'
			);
		});

		it('returns 401 when the user has no Premiumize profile', async () => {
			mockGetProfile.mockResolvedValue(null);
			const result = await getPremiumizeDMMItem('user1', 'folder', 'f1');
			expect(result).toMatchObject({ status: 401 });
		});
	});
});
