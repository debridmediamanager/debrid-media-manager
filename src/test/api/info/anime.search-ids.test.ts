import type { AnimeRecord } from '@/services/database/anime';
import rows from '@/test/fixtures/anime/anime-rows-search-frieren.json';
import searchFrieren from '@/test/fixtures/anime/search-anime-frieren.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import axios from 'axios';
import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Driven from what production actually answered on 2026-09-27: the ids
// /api/search/anime handed out for "frieren", the Anime rows behind them, and
// kitsu.io's responses as dmm-01 received them. The Stremio addon answers
// dmm-01 with a Cloudflare 403 (see the fixture README), which is why the
// Kitsu path is the one production serves from.

vi.mock('axios');
vi.mock('user-agents', () => ({
	default: vi.fn().mockImplementation(() => ({ toString: () => 'TestAgent/1.0' })),
}));

const mockResolveImdbIdFromSimkl = vi.fn();
vi.mock('@/services/anime/simkl', () => ({
	resolveImdbIdFromSimkl: (...args: unknown[]) => mockResolveImdbIdFromSimkl(...args),
}));

type Row = AnimeRecord;
const COLUMN = { anidb: 'anidb_id', mal: 'mal_id', kitsu: 'kitsu_id' } as const;

const mockGetAnimeByExternalId = vi.fn(
	async (source: keyof typeof COLUMN, id: number): Promise<Row | null> =>
		(rows as Row[]).find((row) => row[COLUMN[source]] === id) ?? null
);
vi.mock('@/services/repository', () => ({
	repository: {
		getAnimeByExternalId: (source: keyof typeof COLUMN, id: number) =>
			mockGetAnimeByExternalId(source, id),
	},
}));

const FIXTURES = path.resolve(__dirname, '../../fixtures/anime');
const kitsuFixture = (kitsuId: number) =>
	JSON.parse(readFileSync(path.join(FIXTURES, `kitsu-anime-${kitsuId}.json`), 'utf8'));

describe('/api/info/anime resolves the ids /api/search/anime hands out', () => {
	const originalFetch = global.fetch;
	const kitsuDown = { value: false };

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		kitsuDown.value = false;
		mockResolveImdbIdFromSimkl.mockResolvedValue(null);
		// The addon's answer to dmm-01.
		vi.mocked(axios.get).mockRejectedValue(
			Object.assign(new Error('Request failed with status code 403'), {
				response: { status: 403 },
			})
		);
		global.fetch = vi.fn(async (url: RequestInfo | URL) => {
			const match = /kitsu\.io\/api\/edge\/anime\/(\d+)$/.exec(String(url));
			if (kitsuDown.value || !match) return new Response('', { status: 503 });
			return new Response(JSON.stringify(kitsuFixture(Number(match[1]))), {
				status: 200,
				headers: { 'content-type': 'application/vnd.api+json' },
			});
		}) as typeof fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	const info = async (animeid: string) => {
		const handler = (await import('@/pages/api/info/anime')).default;
		const res = createMockResponse();
		await handler(createMockRequest({ query: { animeid } }), res);
		return res;
	};

	// The deleted anime page linked to `/anime/<id minus "anime:">`, so both
	// spellings of every search hit have to resolve.
	const ids = searchFrieren.results.flatMap(({ id }) => [id, id.replace(/^anime:/, '')]);

	it.each(ids)('serves real metadata for %s', async (animeid) => {
		const row = rows.find(
			(r) =>
				`anime:${r.anidb_id ? `anidb-${r.anidb_id}` : `mal-${r.mal_id}`}` ===
				(animeid.startsWith('anime:') ? animeid : `anime:${animeid}`)
		)!;
		const kitsu = kitsuFixture(row.kitsu_id!).data.attributes;

		const res = await info(animeid);

		expect(res.status).toHaveBeenCalledWith(200);
		const body = vi.mocked(res.json).mock.calls[0][0];
		expect(body.title).toBe(kitsu.canonicalTitle);
		expect(body.title).not.toBe('Unknown');
		expect(body.poster).toBe(kitsu.posterImage.original);
		expect(body.poster).not.toContain('picsum.photos');
	});

	it('resolves mal-52991, the other id production was seen failing on', async () => {
		const res = await info('mal-52991');

		expect(mockGetAnimeByExternalId).toHaveBeenCalledWith('mal', 52991);
		expect(vi.mocked(res.json).mock.calls[0][0].title).toBe('Sousou no Frieren');
	});

	it('serves the Anime row itself when Kitsu is down as well', async () => {
		kitsuDown.value = true;
		const frieren = rows.find((r) => r.anidb_id === 17617)!;

		const res = await info('anidb-17617');

		expect(res.json).toHaveBeenCalledWith({
			title: frieren.title,
			description: frieren.description,
			poster: frieren.poster_url,
			backdrop: frieren.background_url,
			imdbid: '',
			imdbRating: frieren.rating,
		});
	});

	it('takes the imdb id from the row it looked up', async () => {
		mockGetAnimeByExternalId.mockResolvedValueOnce({
			...rows.find((r) => r.anidb_id === 17617)!,
			imdb_id: 'tt22248376',
		});

		const res = await info('anime:anidb-17617');

		expect(vi.mocked(res.json).mock.calls[0][0].imdbid).toBe('tt22248376');
		expect(mockResolveImdbIdFromSimkl).not.toHaveBeenCalled();
	});

	it('asks Simkl in the id space the caller used', async () => {
		mockResolveImdbIdFromSimkl.mockResolvedValue('tt22248376');

		const res = await info('anidb-17617');

		expect(mockResolveImdbIdFromSimkl).toHaveBeenCalledWith('anidb', 17617);
		expect(vi.mocked(res.json).mock.calls[0][0].imdbid).toBe('tt22248376');
	});

	it('rejects an id that names no known id space', async () => {
		const res = await info('tvdb-424536');

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockGetAnimeByExternalId).not.toHaveBeenCalled();
		expect(global.fetch).not.toHaveBeenCalled();
	});
});
