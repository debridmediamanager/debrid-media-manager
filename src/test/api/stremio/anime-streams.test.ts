/**
 * Every DMM Cast stream route, asked for an anime episode the way Stremio asks:
 * with a video id from the Anime Kitsu catalog (`kitsu:46474:5` is Frieren's
 * episode 5 in that addon's own meta). They used to treat it as an IMDb id,
 * looking casts up under `kitsu:46474:5`, which nothing writes, and reading the
 * nonexistent `tv:kitsu:46474:...` release row.
 */
import adStream from '@/pages/api/stremio-ad/[userid]/stream/[mediaType]/[imdbid]';
import dlStream from '@/pages/api/stremio-dl/[userid]/stream/[mediaType]/[imdbid]';
import ocStream from '@/pages/api/stremio-oc/[userid]/stream/[mediaType]/[imdbid]';
import pmStream from '@/pages/api/stremio-pm/[userid]/stream/[mediaType]/[imdbid]';
import tbStream from '@/pages/api/stremio-tb/[userid]/stream/[mediaType]/[imdbid]';
import rdStream from '@/pages/api/stremio/[userid]/stream/[mediaType]/[imdbid]';
import frierenReleases from '@/test/fixtures/anime/scrapedtrue-anime-anidb-17617.json';
import movieMeta from '@/test/fixtures/anime/stremio-anime-kitsu-meta-movie-kitsu-50942.json';
import seriesMeta from '@/test/fixtures/anime/stremio-anime-kitsu-meta-series-kitsu-46474.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { db, mockTorBoxCache, mockPremiumizeCache, mockOffcloudCache } = vi.hoisted(() => ({
	db: {} as Record<string, ReturnType<typeof vi.fn>>,
	mockTorBoxCache: vi.fn(),
	mockPremiumizeCache: vi.fn(),
	mockOffcloudCache: vi.fn(),
}));

vi.mock('@/services/repository', () => ({ repository: db }));
vi.mock('@/services/rateLimit/withRateLimit', () => ({ withRateLimit: (h: unknown) => h }));
vi.mock('@/services/torbox', () => ({ checkCachedStatus: mockTorBoxCache }));
vi.mock('@/services/premiumize', () => ({ checkPremiumizeCache: mockPremiumizeCache }));
vi.mock('@/services/offcloud', () => ({ checkOffcloudCache: mockOffcloudCache }));

/** Frieren's row as `getAnimeByExternalId` selects it in production. */
const FRIEREN_ROW = { anidb_id: 17617, kitsu_id: 46474, mal_id: 52991, imdb_id: 'tt22248376' };
const EPISODE_5 = seriesMeta.meta.videos.find((v) => v.episode === 5)!.id;
const PROFILE = {
	apiKey: 'key',
	movieMaxSize: 0,
	episodeMaxSize: 0,
	otherStreamsLimit: 5,
	hideCastOption: false,
};
const HANDLERS = [
	{ name: 'Real-Debrid', handler: rdStream, prefix: '', trove: false },
	{ name: 'TorBox', handler: tbStream, prefix: 'TorBox', trove: true },
	{ name: 'AllDebrid', handler: adStream, prefix: 'AllDebrid', trove: false },
	{ name: 'Debrid-Link', handler: dlStream, prefix: 'DebridLink', trove: false },
	{ name: 'Offcloud', handler: ocStream, prefix: 'Offcloud', trove: true },
	{ name: 'Premiumize', handler: pmStream, prefix: 'Premiumize', trove: true },
] as const;

const request = async (handler: (req: any, res: any) => unknown, videoId: string, type: string) => {
	const res = createMockResponse();
	await handler(
		createMockRequest({
			query: { userid: 'user-with-profile', mediaType: type, imdbid: `${videoId}.json` },
		}),
		res
	);
	return { status: res.status, body: res._getData() as { streams: any[] } };
};

describe('DMM Cast stream routes for anime ids', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		for (const key of Object.keys(db)) delete db[key];
		for (const { prefix } of HANDLERS) {
			db[`get${prefix}CastProfile`] = vi.fn().mockResolvedValue(PROFILE);
			db[`get${prefix}UserCastStreams`] = vi.fn().mockResolvedValue([]);
			db[`get${prefix}OtherStreams`] = vi.fn().mockResolvedValue([]);
		}
		db.getCastProfile = vi.fn().mockResolvedValue(PROFILE);
		db.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
		db.getAnimeByExternalId = vi.fn(async (source: string, id: number) =>
			source === 'kitsu' && id === 46474 ? FRIEREN_ROW : null
		);
		db.getAllScrapedTrueResults = vi.fn(async (key: string) =>
			key === 'anime:anidb-17617' ? frierenReleases : null
		);
		// Every hash probed is reported cached, so the route's own filtering is
		// what decides which releases are offered.
		mockTorBoxCache.mockImplementation(async ({ hash }: { hash: string[] }) => ({
			success: true,
			data: Object.fromEntries(hash.map((h) => [h, {}])),
		}));
		const allCached = async (_key: string, hashes: string[]) =>
			hashes.map((hash) => ({ hash, cached: true }));
		mockPremiumizeCache.mockImplementation(allCached);
		mockOffcloudCache.mockImplementation(allCached);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it.each(HANDLERS)(
		'$name looks casts up under the key the anime cast route writes',
		async ({ handler, prefix }) => {
			expect(EPISODE_5).toBe('kitsu:46474:5');
			const { body } = await request(handler, EPISODE_5, seriesMeta.meta.type);

			expect(db.getAnimeByExternalId).toHaveBeenCalledWith('kitsu', 46474);
			expect(db[`get${prefix}UserCastStreams`]).toHaveBeenCalledWith(
				'anidb-17617:1:5',
				'user-with-profile',
				5
			);
			expect(db[`get${prefix}OtherStreams`].mock.calls[0][0]).toBe('anidb-17617:1:5');
			expect(body.streams[0].externalUrl).toBe('https://dmm.test/anime/17617');
		}
	);

	it.each(HANDLERS.filter((h) => h.trove))(
		'$name offers the cached releases of that episode from anime:anidb-17617',
		async ({ handler }) => {
			const { body } = await request(handler, EPISODE_5, seriesMeta.meta.type);
			const offered = body.streams.filter((s) => typeof s.url === 'string');

			expect(db.getAllScrapedTrueResults).toHaveBeenCalledWith('anime:anidb-17617');
			expect(db.getAllScrapedTrueResults).toHaveBeenCalledWith('anime:mal-52991');
			expect(offered.length).toBe(5);
			for (const stream of offered) {
				expect(stream.title).toMatch(/Frieren/);
				expect(stream.title).toMatch(/(?:- 05\b|E05\b)/);
			}
		}
	);

	it.each(HANDLERS)(
		'$name answers an anime id the table cannot place with no streams',
		async ({ handler, prefix }) => {
			// Pokemon: Wild Card (kitsu 50942) had no Anime row on 2026-09-27.
			const { body } = await request(handler, movieMeta.meta.id, movieMeta.meta.type);

			expect(movieMeta.meta.id).toBe('kitsu:50942');
			expect(body).toEqual({ streams: [], cacheMaxAge: 0 });
			expect(db[`get${prefix}UserCastStreams`]).not.toHaveBeenCalled();
		}
	);

	it('serves a Real-Debrid cast of that episode back to Stremio', async () => {
		const cast = [
			{
				url: 'https://download.real-debrid.com/d/ABCDEFGHIJKLM/Sousou.no.Frieren.05.mkv',
				link: 'https://real-debrid.com/d/ABCDEFGHIJKLM',
				size: 1429,
				filename: '[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv',
				hash: 'e971d09c2578aefd982b7d4059e8bdd1fc3d2cf4',
			},
		];
		db.getUserCastStreams.mockImplementation(async (key: string) =>
			key === 'anidb-17617:1:5' ? cast : []
		);

		const { body } = await request(rdStream, EPISODE_5, 'series');

		expect(body.streams).toHaveLength(2);
		expect(body.streams[1].url).toBe(
			'https://dmm.test/api/stremio/user-with-profile/play/ABCDEFGHIJKLM'
		);
	});
});
