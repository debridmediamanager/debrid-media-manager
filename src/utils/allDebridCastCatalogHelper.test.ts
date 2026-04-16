import { describe, expect, it, vi } from 'vitest';

const { mockGetMagnetFiles, mockGetMagnetStatusAd } = vi.hoisted(() => ({
	mockGetMagnetFiles: vi.fn(),
	mockGetMagnetStatusAd: vi.fn(),
}));

vi.mock('@/services/allDebrid', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/allDebrid')>('@/services/allDebrid');
	return {
		...actual,
		getMagnetFiles: mockGetMagnetFiles,
		getMagnetStatusAd: mockGetMagnetStatusAd,
	};
});

import { getAllDebridDMMTorrent } from './allDebridCastCatalogHelper';

describe('allDebridCastCatalogHelper', () => {
	it('assigns video indices after sorting so play URLs match /play/[hash] resolver', async () => {
		// AD returns files in scene-release order: sample first, then episodes, then nfo/cover.
		mockGetMagnetFiles.mockResolvedValue({
			magnets: [
				{
					files: [
						{ n: 'RARBG.txt', s: 100 },
						{ n: 'Sample', e: [{ n: 'sample-show.S01E01.mkv', s: 10, l: 'l-sample' }] },
						{ n: 'show.S01E03.mkv', s: 1000, l: 'l-e03' },
						{ n: 'show.S01E01.mkv', s: 1200, l: 'l-e01' },
						{ n: 'show.S01E02.mkv', s: 1100, l: 'l-e02' },
						{ n: 'cover.jpg', s: 50 },
					],
				},
			],
		});
		mockGetMagnetStatusAd.mockResolvedValue({ filename: 'Show.S01.PACK' });

		process.env.DMM_ORIGIN = 'https://dmm.test';

		const result = await getAllDebridDMMTorrent('ad-key', '42', 'user-1');
		if ('error' in result) throw new Error('unexpected error: ' + result.error);

		const videos = result.data.meta.videos;
		// Videos are sorted by basename — same order as /play/ resolves.
		expect(videos.map((v) => v.title.split(' - ')[0])).toEqual([
			'sample-show.S01E01.mkv',
			'show.S01E01.mkv',
			'show.S01E02.mkv',
			'show.S01E03.mkv',
		]);
		// Each URL's index must equal the video's position in the sorted array.
		videos.forEach((v, idx) => {
			expect(v.id).toBe(`dmm-ad:42:${idx}`);
			expect(v.streams[0].url).toBe(`https://dmm.test/api/stremio-ad/user-1/play/42:${idx}`);
		});
	});
});
