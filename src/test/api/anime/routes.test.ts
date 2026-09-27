import { buildFranchiseIndex } from '@/services/anime/animeFranchise';
import type { FribbAnimeEntry } from '@/services/anime/animeMapping';
import { normalizeKitsuAnime } from '@/services/anime/kitsu';
import type { AnimeEntryRow } from '@/services/database/anime';
import rows from '@/test/fixtures/anime/anime-rows-franchises.json';
import fribb from '@/test/fixtures/anime/fribb-franchises.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { readFileSync } from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Both routes over what production held on 2026-09-27: the Fribb entries at
// commit 8e4ec6a2, the `Anime` rows behind them and kitsu.io's answers to
// dmm-01. Only the three data sources are replaced.

const FIXTURES = path.resolve(__dirname, '../../fixtures/anime');
const tableRows = rows as AnimeEntryRow[];

const { mockGetRows, mockGetIndex, mockGetKitsuLabel } = vi.hoisted(() => ({
	mockGetRows: vi.fn(),
	mockGetIndex: vi.fn(),
	mockGetKitsuLabel: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: { getAnimeEntryRows: mockGetRows },
}));
vi.mock('@/services/anime/animeFranchise', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/anime/animeFranchise')>()),
	getFranchiseIndex: mockGetIndex,
}));
vi.mock('@/services/anime/kitsuLabels', () => ({ getKitsuLabel: mockGetKitsuLabel }));

import byImdb from '@/pages/api/anime/by-imdb';
import franchise from '@/pages/api/anime/franchise';

const body = (res: ReturnType<typeof createMockResponse>) => vi.mocked(res.json).mock.calls[0][0];

describe('/api/anime/franchise and /api/anime/by-imdb', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetIndex.mockResolvedValue(buildFranchiseIndex(fribb as FribbAnimeEntry[]));
		mockGetRows.mockImplementation(async ({ anidbIds, imdbIds }) =>
			tableRows.filter(
				(r) =>
					(r.anidb_id !== null && anidbIds.includes(r.anidb_id)) ||
					(r.imdb_id !== null && r.anidb_id !== null && imdbIds.includes(r.imdb_id))
			)
		);
		mockGetKitsuLabel.mockImplementation(async (kitsuId: number) => {
			const file = path.join(FIXTURES, `kitsu-anime-${kitsuId}.json`);
			const meta = normalizeKitsuAnime(
				JSON.parse(readFileSync(file, 'utf8')).data.attributes
			);
			return { title: meta.title, poster: meta.poster };
		});
	});

	it("answers Frieren's franchise with its two later seasons", async () => {
		const res = createMockResponse();

		await franchise(createMockRequest({ query: { anidbid: '17617' } }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(body(res).imdbIds).toEqual(['tt22248376']);
		expect(body(res).entries.map((e: any) => `${e.anidbId} ${e.type} ${e.title}`)).toEqual([
			'17617 TV Sousou no Frieren',
			'18886 TV Sousou no Frieren 2nd Season',
			'19977 TV Sousou no Frieren 3rd Season',
		]);
	});

	it.each([['0'], ['abc'], ['17617.5'], [''], ['-1'], ['99999999']])(
		'refuses anidbid=%s',
		async (anidbid) => {
			const res = createMockResponse();

			await franchise(createMockRequest({ query: { anidbid } }), res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(mockGetRows).not.toHaveBeenCalled();
		}
	);

	it('answers an id nothing knows as unknown rather than an error', async () => {
		const res = createMockResponse();

		await franchise(createMockRequest({ query: { anidbid: '9999999' } }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(body(res)).toEqual({ anidbId: 9999999, known: false, imdbIds: [], entries: [] });
	});

	it('maps a batch of IMDb ids, leaving out the ones with no entry', async () => {
		const res = createMockResponse();

		await byImdb(
			createMockRequest({ query: { imdbids: 'tt10885406,tt0903747,tt26743760,tt10885406' } }),
			res
		);

		expect(res.status).toHaveBeenCalledWith(200);
		const { results } = body(res);
		expect(Object.keys(results).sort()).toEqual(['tt10885406', 'tt26743760']);
		expect(results.tt10885406).toHaveLength(5);
		expect(results.tt26743760.map((e: any) => e.anidbId)).toEqual([17870, 18562, 19444, 19671]);
	});

	it.each([
		['no ids', ''],
		['a non-IMDb id', 'tt1,anidb-17617'],
		['more than 100 ids', Array.from({ length: 101 }, (_, i) => `tt${i + 1}`).join(',')],
	])('refuses %s', async (_label, imdbids) => {
		const res = createMockResponse();

		await byImdb(createMockRequest({ query: { imdbids } }), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockGetRows).not.toHaveBeenCalled();
	});

	it('answers 500, not an empty map, when the database fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockGetRows.mockRejectedValue(new Error('down'));
		const res = createMockResponse();

		await byImdb(createMockRequest({ query: { imdbids: 'tt10885406' } }), res);

		expect(res.status).toHaveBeenCalledWith(500);
	});
});
