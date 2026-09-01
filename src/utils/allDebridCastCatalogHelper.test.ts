import { describe, expect, it, vi } from 'vitest';

const {
	mockGetMagnetFiles,
	mockGetMagnetStatusAd,
	mockGetMagnetStatus,
	mockGetSavedLinks,
	mockUnlockLink,
} = vi.hoisted(() => ({
	mockGetMagnetFiles: vi.fn(),
	mockGetMagnetStatusAd: vi.fn(),
	mockGetMagnetStatus: vi.fn(),
	mockGetSavedLinks: vi.fn(),
	mockUnlockLink: vi.fn(),
}));

vi.mock('@/services/allDebrid', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/allDebrid')>('@/services/allDebrid');
	return {
		...actual,
		getMagnetFiles: mockGetMagnetFiles,
		getMagnetStatusAd: mockGetMagnetStatusAd,
		getMagnetStatus: mockGetMagnetStatus,
		getSavedLinks: mockGetSavedLinks,
		unlockLink: mockUnlockLink,
	};
});

import {
	PAGE_SIZE,
	getAllDebridDMMLibrary,
	getAllDebridDMMTorrent,
	getAllDebridSavedLink,
	parseSavedLinkMetaId,
	savedLinkMetaId,
} from './allDebridCastCatalogHelper';

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

describe('getAllDebridDMMLibrary', () => {
	const magnets = (count: number) =>
		Array.from({ length: count }, (_, i) => ({
			id: i,
			filename: `Release.${i}`,
			statusCode: 4,
		}));

	beforeEach(() => {
		mockGetSavedLinks.mockResolvedValue([]);
	});

	it('pages 1-based, the way the other three provider catalogs do', async () => {
		mockGetMagnetStatus.mockResolvedValue({ data: { magnets: magnets(30) } });

		const first = await getAllDebridDMMLibrary('ad-key', 1);
		expect(first.metas).toHaveLength(PAGE_SIZE);
		expect(first.metas[0].id).toBe('dmm-ad:0');
		expect(first.hasMore).toBe(true);

		const third = await getAllDebridDMMLibrary('ad-key', 3);
		expect(third.metas[0].id).toBe(`dmm-ad:${PAGE_SIZE * 2}`);
		expect(third.metas).toHaveLength(30 - PAGE_SIZE * 2);
		expect(third.hasMore).toBe(false);
	});

	it('skips magnets that are not ready', async () => {
		mockGetMagnetStatus.mockResolvedValue({
			data: {
				magnets: [
					{ id: 1, filename: 'done', statusCode: 4 },
					{ id: 2, filename: 'downloading', statusCode: 1 },
				],
			},
		});
		const result = await getAllDebridDMMLibrary('ad-key', 1);
		expect(result.metas).toEqual([{ id: 'dmm-ad:1', name: 'done', type: 'other' }]);
		expect(result.hasMore).toBe(false);
	});

	it('returns an empty page rather than throwing when AllDebrid errors', async () => {
		mockGetMagnetStatus.mockRejectedValue(new Error('AD down'));
		expect(await getAllDebridDMMLibrary('ad-key', 1)).toEqual({ metas: [], hasMore: false });
	});
});

describe('AllDebrid saved links', () => {
	const LINK = 'https://1fichier.com/?lemotqxaz1mytbbh93i5';

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DMM_ORIGIN = 'https://dmm.test';
		mockGetMagnetStatus.mockResolvedValue({ data: { magnets: [] } });
		mockGetSavedLinks.mockResolvedValue([]);
	});

	// A saved link has no id at AllDebrid - the URL is the key - so the meta id
	// carries the URL itself rather than an index into a list that reorders.
	it('round-trips a link through its meta id', () => {
		const id = savedLinkMetaId(LINK);
		expect(id.startsWith('l')).toBe(true);
		expect(id).not.toContain(':');
		expect(parseSavedLinkMetaId(id)).toBe(LINK);
	});

	it.each(['123', 'lnot-base64!!', 'l'])('rejects %s as a saved link id', (id) => {
		expect(parseSavedLinkMetaId(id)).toBeNull();
	});

	it('lists saved links ahead of magnets', async () => {
		mockGetSavedLinks.mockResolvedValue([
			{ link: LINK, filename: 'ztest-rar5.rar', size: 1, date: 1, host: '1fichier' },
		]);
		mockGetMagnetStatus.mockResolvedValue({
			data: { magnets: [{ id: 7, filename: 'A Movie', statusCode: 4 }] },
		});

		const result = await getAllDebridDMMLibrary('ad-key', 1);
		expect(result.metas.map((m) => m.name)).toEqual(['ztest-rar5.rar', 'A Movie']);
		expect(result.metas[0].id).toBe(`dmm-ad:${savedLinkMetaId(LINK)}`);
	});

	// Losing the saved links must not cost the user their magnets.
	it('still lists magnets when the saved link call fails', async () => {
		mockGetSavedLinks.mockRejectedValue(new Error('AD down'));
		mockGetMagnetStatus.mockResolvedValue({
			data: { magnets: [{ id: 7, filename: 'A Movie', statusCode: 4 }] },
		});

		const result = await getAllDebridDMMLibrary('ad-key', 1);
		expect(result.metas.map((m) => m.name)).toEqual(['A Movie']);
	});

	it('builds a one-file meta by unlocking the link', async () => {
		mockUnlockLink.mockResolvedValue({ filename: 'ztest-rar5.rar', filesize: 1024 ** 3 });
		const id = savedLinkMetaId(LINK);

		const result = await getAllDebridSavedLink('ad-key', id, 'user1');
		if ('error' in result) throw new Error(result.error);

		expect(mockUnlockLink).toHaveBeenCalledWith('ad-key', LINK);
		expect(result.data.meta.name).toBe('DMM AD: ztest-rar5.rar - 1.00 GB');
		expect(result.data.meta.videos[0].streams[0].url).toBe(
			`https://dmm.test/api/stremio-ad/user1/play/${id}:0`
		);
	});

	it('400s an id that is not a saved link', async () => {
		expect(await getAllDebridSavedLink('ad-key', '123', 'user1')).toMatchObject({
			status: 400,
		});
	});

	it('500s when the link will not unlock', async () => {
		mockUnlockLink.mockRejectedValue(new Error('LINK_DOWN'));
		expect(await getAllDebridSavedLink('ad-key', savedLinkMetaId(LINK), 'user1')).toMatchObject(
			{ status: 500 }
		);
	});
});
