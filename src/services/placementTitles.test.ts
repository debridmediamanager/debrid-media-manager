import cyberpunkEdgerunners from '@/test/fixtures/metadata/tmdb-tv-105248-cyberpunk-edgerunners.json';
import aliceInBorderland from '@/test/fixtures/metadata/tmdb-tv-110316-alice-in-borderland.json';
import linkClick from '@/test/fixtures/metadata/tmdb-tv-123542-link-click.json';
import roosterFighter from '@/test/fixtures/metadata/tmdb-tv-259819-rooster-fighter.json';
import detectiveConan from '@/test/fixtures/metadata/tmdb-tv-30983-detective-conan.json';
import onePieceLog from '@/test/fixtures/metadata/tmdb-tv-334601-one-piece-log-fish-man-island-saga.json';
import theSimpsons from '@/test/fixtures/metadata/tmdb-tv-456-the-simpsons.json';
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
			tvdbId: 72454,
		});
	});

	it("gives a show the TVDB id TMDB records, which Plex's show rows carry", async () => {
		const placed: PlacedRelease = {
			kind: 'tv',
			imdbId: 'tt0096697',
			tmdbId: 456,
			files: [
				{
					path: 'The.Simpsons.S38E03.720p.HDTV.x264-SYNCOPY.mkv',
					...episode,
					season: 38,
					episode: 3,
				},
			],
		};
		expect((await titled(placed, sources)).tvdbId).toBe(71663);
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
		const unnamed: PlacedRelease = {
			kind: 'movie',
			imdbId: 'tt33086804',
			tmdbId: 1,
			files: [],
		};
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

describe('anime', () => {
	// TMDB's `/tv/{id}` records with DMM's appends, keywords included, captured 2026-11-09: what
	// placement already reads
	const shows: Record<number, unknown> = {
		30983: detectiveConan,
		456: theSimpsons,
		110316: aliceInBorderland,
		334601: onePieceLog,
		105248: cyberpunkEdgerunners,
		259819: roosterFighter,
		123542: linkClick,
	};
	const captured = {
		show: async (id: number) => shows[id] ?? null,
		find: async (imdbId: string) => (titles as any)[`find/${imdbId}`] ?? null,
	} as unknown as PlacementSources;
	const show = (imdbId: string, tmdbId: number | null): PlacedRelease => ({
		kind: 'tv',
		imdbId,
		tmdbId,
		files: [{ path: 'Show.S01E01.mkv', ...episode, episode: 1 }],
	});

	it('answers true for a Japanese animated show: Animation, ja, JP', async () => {
		expect((await titled(show('tt0131179', 30983), captured)).anime).toBe(true);
	});

	// a real library's misses under the three fields alone (2026-11-09), each tagged `anime` on TMDB
	it('answers true for a show TMDB tags with the keyword anime, whatever its genres or origin', async () => {
		// One Piece Log: Fish-Man Island Saga: ja, JP, but Action & Adventure (10759) alone
		expect((await titled(show('tt33992229', 334601), captured)).anime).toBe(true);
		// Cyberpunk: Edgerunners: Animation, but en, from JP, PL and US
		expect((await titled(show('tt12590266', 105248), captured)).anime).toBe(true);
		// Rooster Fighter: Animation, en, US
		expect((await titled(show('tt33086804', 259819), captured)).anime).toBe(true);
	});

	it('answers false for animation from elsewhere and for Japanese live action', async () => {
		// The Simpsons: Animation, en, US, no anime keyword
		expect(await titled(show('tt0096697', 456), captured)).toHaveProperty('anime', false);
		// Alice in Borderland: ja, JP, no Animation, no anime keyword
		expect(await titled(show('tt10795658', 110316), captured)).toHaveProperty('anime', false);
		// LINK CLICK: Chinese animation (zh, CN), no anime keyword
		expect(await titled(show('tt14976292', 123542), captured)).toHaveProperty('anime', false);
	});

	it('reads the three fields alone from a record without keywords', async () => {
		const unkeyed = {
			...captured,
			show: async (id: number) => ({ ...(shows[id] as object), keywords: undefined }),
		} as PlacementSources;
		expect(await titled(show('tt0131179', 30983), unkeyed)).toHaveProperty('anime', true);
		expect(await titled(show('tt33992229', 334601), unkeyed)).toHaveProperty('anime', false);
	});

	it('leaves it out where the show is unknown or its record could not be read', async () => {
		expect(await titled(show('tt0131179', null), captured)).not.toHaveProperty('anime');
		const unread = { ...captured, show: async () => null } as PlacementSources;
		expect(await titled(show('tt0131179', 30983), unread)).not.toHaveProperty('anime');
	});

	it('never answers it for a movie', async () => {
		const movie: PlacedRelease = {
			kind: 'movie',
			imdbId: 'tt29714073',
			tmdbId: 1198654,
			files: [{ path: 'Bad Apples 1080.mkv', ...episode, season: null, episode: null }],
		};
		const out = await titled(movie, captured);
		expect(out.title).toBe('Bad Apples');
		expect(out).not.toHaveProperty('anime');
	});
});
