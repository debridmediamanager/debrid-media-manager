import { EasynewsGoneError, resolveEasynewsLink } from '@/services/easynews';
import { fetchMovieSources, fetchShowSources } from '@/services/metadata';
import bear from '@/test/fixtures/easynews/search-cocaine-bear-2023-2026-10-25.json';
import severance from '@/test/fixtures/easynews/search-severance-s02-2026-10-25.json';
import { mergeMovieRecord, mergeShowRecord } from '@/utils/metadataRecord';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	easynewsReleaseOf,
	easynewsStreamResults,
	easynewsTargetFor,
	goneEasynewsPaths,
	namesEpisode,
} from './easynewsCastSearch';

vi.mock('@/services/easynews', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/easynews')>()),
	resolveEasynewsLink: vi.fn(),
}));
vi.mock('@/services/metadata', () => ({
	fetchMovieSources: vi.fn(),
	fetchShowSources: vi.fn(),
}));
vi.mock('@/utils/metadataRecord', () => ({
	mergeMovieRecord: vi.fn(),
	mergeShowRecord: vi.fn(),
}));

const login = { username: 'alice', password: 'pw' };

describe('easynewsCastSearch', () => {
	beforeEach(() => {
		vi.mocked(fetchMovieSources).mockResolvedValue({} as any);
		vi.mocked(fetchShowSources).mockResolvedValue({ tmdb: { origin_country: ['US'] } } as any);
		vi.mocked(mergeMovieRecord).mockReturnValue({
			title: 'Cocaine Bear',
			year: 2023,
			sources: ['tmdb'],
		} as any);
		vi.mocked(mergeShowRecord).mockReturnValue({
			title: 'Severance',
			year: 2022,
			sources: ['tmdb'],
		} as any);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('searches a film by title and year, a show by title, season and countries', async () => {
		await expect(easynewsTargetFor('tt14141770')).resolves.toEqual({
			target: { title: 'Cocaine Bear', year: '2023' },
		});
		await expect(easynewsTargetFor('tt11280740:2:5')).resolves.toEqual({
			target: { title: 'Severance', seasonNum: 2, countries: ['US'] },
			episode: 5,
		});
	});

	it('has no search for an anime key or a title no source knows', async () => {
		await expect(easynewsTargetFor('anidb-1:1:1')).resolves.toBeNull();
		vi.mocked(mergeMovieRecord).mockReturnValue({ title: '', sources: [] } as any);
		await expect(easynewsTargetFor('tt0000001')).resolves.toBeNull();
	});

	// Driven by the recorded "Severance S02" search: the season query returns every
	// episode (and Lost.in.Space ...Severed, Airwolf ...Severance.Pay); one episode's
	// stream list gets that episode only.
	it('keeps only the asked episode from a recorded season search', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(severance)))
		);
		const results = await easynewsStreamResults(login, 'tt11280740:2:5');
		expect(results.length).toBeGreaterThan(0);
		for (const r of results) expect(r.title.toLowerCase()).toMatch(/severance.*s02e05/);
		expect(results.map((r) => r.title)).toContain(
			'severance.2022.s02e05.multi.2160p.web.h265-higgsboson'
		);
		const sizes = results.map((r) => r.size);
		expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
	});

	it('applies the size limit in GB', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(severance)))
		);
		// S02E01 is recorded as an 8.8 GB 2160p and a 3.4 GB 1080p.
		const all = await easynewsStreamResults(login, 'tt11280740:2:1');
		const limited = await easynewsStreamResults(login, 'tt11280740:2:1', 5);
		expect(all.map((r) => r.title)).toEqual([
			'severance.2022.s02e01.multi.dv.2160p.web.h265-higgsboson',
			'Severance.S02E01.iTALiAN.1080p.WEB.H264-NEUROSiS',
		]);
		expect(limited.map((r) => r.title)).toEqual([
			'Severance.S02E01.iTALiAN.1080p.WEB.H264-NEUROSiS',
		]);
	});

	it('finds the film from a recorded search', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(bear)))
		);
		const results = await easynewsStreamResults(login, 'tt14141770');
		expect(results.length).toBeGreaterThan(0);
		for (const r of results) expect(r.title.toLowerCase()).toMatch(/^cocaine\W+bear\W+2023\b/);
	});

	it('reads episode numbers, multi-episode files included', () => {
		expect(namesEpisode('Show.S02E05.1080p.WEB.h264-GRP', 2, 5)).toBe(true);
		expect(namesEpisode('Show.S02E05E06.1080p.WEB.h264-GRP', 2, 6)).toBe(true);
		expect(namesEpisode('Show.S02E15.1080p.WEB.h264-GRP', 2, 5)).toBe(false);
		expect(namesEpisode('Show.S03E05.1080p.WEB.h264-GRP', 2, 5)).toBe(false);
	});

	// Stremio plays the next episode only from a stream with the same bingeGroup.
	it('names one release for every episode of it', () => {
		expect(easynewsReleaseOf('Severance.S02E05.1080p.WEB.h264-GRP')).toBe(
			easynewsReleaseOf('Severance.S02E06.1080p.WEB.h264-GRP')
		);
		expect(easynewsReleaseOf('Severance.S02E05.1080p.WEB.h264-GRP')).not.toBe(
			easynewsReleaseOf('Severance.S02E06.2160p.WEB.h265-OTHER')
		);
		expect(easynewsReleaseOf('Show.S01E01E02.720p.HDTV.x264-GRP')).toBe(
			'show.s01.720p.hdtv.x264-grp'
		);
	});

	it('counts a file as gone only when Easynews says so', async () => {
		vi.mocked(resolveEasynewsLink).mockImplementation(async (_, path) => {
			if (path === 'dead') throw new EasynewsGoneError();
			if (path === 'flaky') throw new Error('Easynews did not hand out a link: HTTP 502');
			return 'https://members.easynews.com/signed';
		});
		await expect(goneEasynewsPaths(login, ['dead', 'flaky', 'live'])).resolves.toEqual(
			new Set(['dead'])
		);
	});
});
