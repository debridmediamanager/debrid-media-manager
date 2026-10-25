import handler from '@/pages/api/arr/[...route]';
import { getMetadataCache } from '@/services/metadataCache';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { resolveWantedReused } from '@/services/wanted';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/wanted', () => ({ resolveWantedReused: vi.fn() }));
vi.mock('@/services/metadataCache', () => ({ getMetadataCache: vi.fn() }));
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

const db = vi.mocked(repository);
const KEY = 'c'.repeat(64);
const row = (over: Record<string, unknown>) => ({
	id: 'row',
	imdbId: 'tt0133093',
	kind: 'movie',
	title: 'The Matrix',
	seasons: null,
	createdAt: new Date('2026-10-25T00:00:00Z'),
	fulfilledAt: null,
	lastPolledAt: null,
	...over,
});

// TMDB as the metadata cache answers it: The Matrix (603) and Severance (95396, TheTVDB 371980).
const tmdb = {
	getTmdbMovieInfo: vi.fn(async (id: number) =>
		id === 603
			? { id: 603, title: 'The Matrix', imdb_id: 'tt0133093', release_date: '1999-03-31' }
			: {}
	),
	getTmdbPassthrough: vi.fn(async (path: string) =>
		path === 'find/371980' ? { tv_results: [{ id: 95396 }] } : { tv_results: [] }
	),
	getTmdbTvInfo: vi.fn(async () => ({
		id: 95396,
		name: 'Severance',
		first_air_date: '2022-02-17',
		external_ids: { imdb_id: 'tt11280740', tvdb_id: 371980 },
		seasons: [{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }],
	})),
};

async function call(method: string, path: string, opts: { body?: any; query?: any } = {}) {
	const res = createMockResponse();
	await handler(
		createMockRequest({
			method,
			body: opts.body,
			query: { route: path.split('/').filter(Boolean), apikey: KEY, ...opts.query },
		}),
		res
	);
	return {
		status: vi.mocked(res.status).mock.calls[0]?.[0],
		body: vi.mocked(res.json).mock.calls[0]?.[0],
	};
}

describe('/api/arr (Seerr talking to DMM as Radarr and Sonarr)', () => {
	beforeEach(() => {
		db.getSponsorByDmmApiKey = vi.fn().mockResolvedValue({ isSponsor: true, shortId: 'ZP1M' });
		db.listWanted = vi.fn().mockResolvedValue([]);
		db.want = vi.fn(async (_s: string, item: any) => row({ ...item })) as any;
		db.unwant = vi.fn().mockResolvedValue(true);
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
		vi.mocked(getMetadataCache).mockReturnValue(tmdb as any);
		vi.mocked(resolveWantedReused).mockImplementation(async (r: any) =>
			r.kind === 'movie'
				? { id: r.id, kind: 'movie', title: r.title, imdb: r.imdbId, tmdb: 603, year: 1999 }
				: {
						id: r.id,
						kind: 'show',
						title: r.title,
						imdb: r.imdbId,
						tmdb: 95396,
						tvdb: 371980,
						seasons: [{ season: 2, episodes: [1, 2, 3] }],
					}
		);
	});
	afterEach(() => vi.clearAllMocks());

	it('refuses a wrong key and a lapsed sponsorship', async () => {
		db.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(null);
		expect((await call('GET', '/radarr/api/v3/system/status')).status).toBe(401);
		db.getSponsorByDmmApiKey = vi.fn().mockResolvedValue({ isSponsor: false, shortId: 'ZP1M' });
		expect((await call('GET', '/radarr/api/v3/system/status')).status).toBe(401);
	});

	// Seerr's "Test" button: status, then profiles, root folders and tags; it fills
	// the URL base from status, and Sonarr 4 skips language profiles.
	it('passes the settings test for both apps', async () => {
		for (const app of ['radarr', 'sonarr']) {
			const status = await call('GET', `/${app}/api/v3/system/status`);
			expect(status.body.urlBase).toBe(`/api/arr/${app}`);
			expect(Number(status.body.version.split('.')[0])).toBeGreaterThan(3);
			expect((await call('GET', `/${app}/api/v3/qualityProfile`)).body).toEqual([
				{ id: 1, name: 'Any' },
			]);
			expect((await call('GET', `/${app}/api/v3/rootfolder`)).body[0].path).toBe('/dmm');
			expect((await call('GET', `/${app}/api/v3/tag`)).body).toEqual([]);
		}
	});

	// RadarrAPI.addMovie: lookup tmdb:603 finds no id, so it POSTs.
	it('adds a requested film to the wanted list', async () => {
		const lookup = await call('GET', '/radarr/api/v3/movie/lookup', {
			query: { term: 'tmdb:603' },
		});
		expect(lookup.body[0]).toMatchObject({ tmdbId: 603, hasFile: false, monitored: false });
		expect(lookup.body[0].id).toBeUndefined();

		const added = await call('POST', '/radarr/api/v3/movie', {
			body: {
				title: 'The Matrix',
				qualityProfileId: 1,
				profileId: 1,
				titleSlug: '603',
				minimumAvailability: 'released',
				tmdbId: 603,
				year: 1999,
				rootFolderPath: '/dmm',
				monitored: true,
				tags: [],
				addOptions: { searchForMovie: true },
			},
		});
		expect(added.status).toBe(201);
		expect(added.body.id).toBe(603);
		expect(db.want).toHaveBeenCalledWith('ZP1M', {
			imdbId: 'tt0133093',
			kind: 'movie',
			title: 'The Matrix',
			seasons: null,
		});
	});

	// RadarrScanner: monitored without a file is processing, a file is available.
	it('lists films with zurg-acknowledged ones as having a file', async () => {
		db.listWanted = vi
			.fn()
			.mockResolvedValue([
				row({ fulfilledAt: new Date() }),
				row({ kind: 'show', imdbId: 'tt11280740' }),
			]);
		const { body } = await call('GET', '/radarr/api/v3/movie');
		expect(body).toHaveLength(1);
		expect(body[0]).toMatchObject({ id: 603, tmdbId: 603, monitored: true, hasFile: true });
		expect((await call('GET', '/radarr/api/v3/movie/603')).body.id).toBe(603);
		expect((await call('GET', '/radarr/api/v3/movie/604')).status).toBe(404);
	});

	// SonarrAPI.addSeries for a first request of season 1: every season from the
	// lookup with monitored false, then the asked one flipped to true.
	it('adds the requested seasons of a show', async () => {
		const lookup = await call('GET', '/sonarr/api/v3/series/lookup', {
			query: { term: 'tvdb:371980' },
		});
		expect(lookup.body[0].seasons.map((s: any) => s.seasonNumber)).toEqual([1, 2]);

		const added = await call('POST', '/sonarr/api/v3/series', {
			body: {
				tvdbId: 371980,
				title: 'Severance',
				qualityProfileId: 1,
				seasons: [
					{ seasonNumber: 1, monitored: true },
					{ seasonNumber: 2, monitored: false },
				],
				tags: [],
				seasonFolder: true,
				monitored: true,
				monitorNewItems: 'all',
				rootFolderPath: '/dmm',
				seriesType: 'standard',
				addOptions: { ignoreEpisodesWithFiles: true, searchForMissingEpisodes: true },
			},
		});
		expect(added.status).toBe(201);
		expect(added.body.id).toBe(371980);
		expect(db.want).toHaveBeenCalledWith('ZP1M', {
			imdbId: 'tt11280740',
			kind: 'show',
			title: 'Severance',
			seasons: [1],
		});
	});

	// A later request for the rest: Seerr PUTs the looked-up series back with the
	// seasons already wanted still monitored, which now covers every season.
	it('wants every season once all are monitored', async () => {
		db.listWanted = vi
			.fn()
			.mockResolvedValue([row({ kind: 'show', imdbId: 'tt11280740', seasons: [1] })]);
		const [series] = (
			await call('GET', '/sonarr/api/v3/series/lookup', { query: { term: 'tvdb:371980' } })
		).body;
		expect(series.id).toBe(371980);
		expect(series.seasons).toEqual([
			{ seasonNumber: 1, monitored: true },
			{ seasonNumber: 2, monitored: false },
		]);
		series.seasons[1].monitored = true;
		const updated = await call('PUT', '/sonarr/api/v3/series', { body: series });
		expect(updated.status).toBe(202);
		expect(vi.mocked(db.want).mock.calls[0][1].seasons).toBeNull();
	});

	it('removes a title Seerr deletes', async () => {
		db.listWanted = vi.fn().mockResolvedValue([row({})]);
		expect((await call('DELETE', '/radarr/api/v3/movie/603')).status).toBe(200);
		expect(db.unwant).toHaveBeenCalledWith('ZP1M', 'tt0133093');
		expect((await call('DELETE', '/sonarr/api/v3/series/371980')).status).toBe(404);
	});

	it('refuses a film TMDB has no IMDb id for', async () => {
		const { status } = await call('POST', '/radarr/api/v3/movie', { body: { tmdbId: 999 } });
		expect(status).toBe(400);
		expect(db.want).not.toHaveBeenCalled();
	});

	// Seerr's "Open in Radarr/Sonarr" links to <url base>/movie/<titleSlug> or
	// /series/<titleSlug>, without the key: send it to the title's DMM page.
	it("sends Seerr's Open in Radarr and Sonarr links to the DMM page", async () => {
		const open = async (path: string) => {
			const res = createMockResponse();
			await handler(
				createMockRequest({ method: 'GET', query: { route: path.split('/') } }),
				res
			);
			return res;
		};
		expect((await open('radarr/movie/603')).redirect).toHaveBeenCalledWith(
			302,
			'/movie/tt0133093'
		);
		expect((await open('sonarr/series/371980')).redirect).toHaveBeenCalledWith(
			302,
			'/show/tt11280740'
		);
		expect((await open('radarr/movie/999')).status).toHaveBeenCalledWith(404);
		expect(db.getSponsorByDmmApiKey).not.toHaveBeenCalled();
	});

	// DownloadTracker every minute: a refresh command, then the queue.
	it('answers the download sync with an empty queue', async () => {
		expect(
			(
				await call('POST', '/radarr/api/v3/command', {
					body: { name: 'RefreshMonitoredDownloads' },
				})
			).status
		).toBe(201);
		expect(
			(await call('GET', '/sonarr/api/v3/queue', { query: { includeEpisode: 'true' } })).body
				.records
		).toEqual([]);
	});
});
