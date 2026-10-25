import { describe, expect, it } from 'vitest';
import titles from '../test/fixtures/placement/titles.json';
import { titled, type PlacedRelease, type PlacementSources } from './placement';

// TMDB's own records, captured 2026-10-25: what placement already reads for these ids
const sources = {
	show: async (id: number) => (titles as any)[`show/${id}`] ?? null,
	find: async (imdbId: string) => (titles as any)[`find/${imdbId}`] ?? null,
} as unknown as PlacementSources;

const episode = { season: 1, episode: 1194, episodeEnd: null, how: null, tmdbEpisodeId: null };

describe('titled', () => {
	it('names a show by TMDB title and first-air year', async () => {
		const placed: PlacedRelease = {
			kind: 'tv',
			imdbId: 'tt0131179',
			tmdbId: 30983,
			files: [
				{ path: '[SubsPlease] Detective Conan - 1194 (1080p) [172108E7].mkv', ...episode },
			],
		};
		expect(await titled(placed, sources)).toEqual({
			...placed,
			title: 'Detective Conan',
			year: 1996,
		});
	});

	it('names a film by the TMDB movie its ids name', async () => {
		const placed: PlacedRelease = {
			kind: 'movie',
			imdbId: 'tt29714073',
			tmdbId: 1198654,
			files: [
				{
					path: 'Bad Apples 1080.mkv',
					season: null,
					episode: null,
					episodeEnd: null,
					how: null,
					tmdbEpisodeId: null,
				},
			],
		};
		expect(await titled(placed, sources)).toMatchObject({ title: 'Bad Apples', year: 2026 });
	});

	it('names a film placed inside a show pack under its own title', async () => {
		const film = {
			path: 'Extras/Tom and Jerry 2021.mkv',
			season: null,
			episode: null,
			episodeEnd: null,
			how: null,
			tmdbEpisodeId: null,
			kind: 'movie' as const,
			imdbId: 'tt1361336',
			tmdbId: 587807,
		};
		const placed: PlacedRelease = {
			kind: 'tv',
			imdbId: 'tt0131179',
			tmdbId: 30983,
			files: [film],
		};
		const out = await titled(placed, sources);
		expect(out.files[0]).toEqual({ ...film, title: 'Tom & Jerry', year: 2021 });
	});

	it('leaves a release TMDB cannot name, or one still waiting, as it was', async () => {
		const unnamed: PlacedRelease = { kind: 'movie', imdbId: 'tt0000001', tmdbId: 1, files: [] };
		expect(await titled(unnamed, sources)).toEqual(unnamed);
		const waiting: PlacedRelease = {
			kind: null,
			imdbId: null,
			tmdbId: null,
			files: [],
			skipped: true,
		};
		expect(await titled(waiting, sources)).toEqual(waiting);
	});
});
