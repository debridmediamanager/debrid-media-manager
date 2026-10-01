import episodeReleases from '@/test/fixtures/anime/anime-episode-releases.json';
import frierenReleases from '@/test/fixtures/anime/scrapedtrue-anime-anidb-17617.json';
import bookwormReleases from '@/test/fixtures/anime/scrapedtrue-anime-anidb-18302.json';
import kitsuManifest from '@/test/fixtures/anime/stremio-anime-kitsu-manifest.json';
import otherIds from '@/test/fixtures/anime/stremio-anime-kitsu-meta-by-other-ids.json';
import movieMeta from '@/test/fixtures/anime/stremio-anime-kitsu-meta-movie-kitsu-50942.json';
import seriesMeta from '@/test/fixtures/anime/stremio-anime-kitsu-meta-series-kitsu-46474.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetAll, mockGetAnime, mockGetTrove } = vi.hoisted(() => ({
	mockGetAll: vi.fn(),
	mockGetAnime: vi.fn(),
	mockGetTrove: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		getAllScrapedTrueResults: mockGetAll,
		getAnimeByExternalId: mockGetAnime,
	},
}));

vi.mock('@/utils/cachedTroveStreams', () => ({ getTroveCandidates: mockGetTrove }));

import {
	ANIME_STREAM_ID_PREFIXES,
	animeEpisodesNamed,
	canonicalAnimeCastId,
	CAST_STREAM_RESOURCE,
	filterAnimeTroveCandidates,
	parseStremioAnimeId,
	resolveStreamTarget,
} from './stremioAnime';

/** The Frieren row as `getAnimeByExternalId` selects it in production. */
const FRIEREN_ROW = { anidb_id: 17617, kitsu_id: 46474, mal_id: 52991, imdb_id: 'tt22248376' };

describe('the ids anime catalogs hand Stremio', () => {
	it('declares a stream prefix for every id the Anime Kitsu addon resolves', () => {
		// That addon's own manifest: `kitsu`, `mal`, `anilist`, `anidb`.
		for (const prefix of ANIME_STREAM_ID_PREFIXES) {
			expect(kitsuManifest.idPrefixes).toContain(prefix);
		}
		expect(CAST_STREAM_RESOURCE.idPrefixes).toEqual(['tt', 'kitsu', 'mal', 'anidb']);
	});

	it('parses every episode id of a real series meta and the id of a real film', () => {
		const videos = seriesMeta.meta.videos;
		expect(videos).toHaveLength(28);
		for (const video of videos) {
			expect(parseStremioAnimeId(video.id)).toEqual({
				source: 'kitsu',
				id: 46474,
				season: null,
				episode: video.episode,
			});
		}
		expect(parseStremioAnimeId(movieMeta.meta.id)).toEqual({
			source: 'kitsu',
			id: 50942,
			season: null,
			episode: null,
		});
	});

	it('gets Kitsu video ids back when the meta was asked for by mal, anidb or anilist', () => {
		for (const resolved of Object.values(otherIds)) {
			expect(resolved.id).toBe('kitsu:46474');
			expect(resolved.videoIds[0]).toBe('kitsu:46474:1');
		}
	});

	it('leaves IMDb ids and other prefixes alone', () => {
		expect(parseStremioAnimeId('tt22248376:1:5')).toBeNull();
		expect(parseStremioAnimeId('anilist:154587:5')).toBeNull();
		expect(parseStremioAnimeId('kitsu:abc:5')).toBeNull();
	});
});

describe('canonicalAnimeCastId', () => {
	it('files every spelling of an AniDB id the way 2024 cast rows are keyed', () => {
		for (const raw of [
			'17617',
			'anidb-17617',
			'anidb17617',
			'anidb:17617',
			'anime:anidb-17617',
		]) {
			expect(canonicalAnimeCastId(raw)).toBe('anidb-17617');
		}
		expect(canonicalAnimeCastId('mal-52991')).toBe('mal-52991');
	});
});

describe('animeEpisodesNamed', () => {
	it('reads the fansub, SxxEyy and E-number shapes', () => {
		expect(
			animeEpisodesNamed('[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv')
		).toEqual({ season: null, episodes: [5] });
		expect(
			animeEpisodesNamed("[Yameii] Frieren - Beyond Journey's End - S01E08 [English Dub]")
		).toEqual({ season: 1, episodes: [8] });
		expect(
			animeEpisodesNamed(
				"[ToonsHub] Frieren- Beyond Journey's End E27 An Era of Humans 2160p"
			)
		).toEqual({ season: null, episodes: [27] });
		expect(
			animeEpisodesNamed('[SubsPlease] Honzuki no Gekokujou S4 - 23 (1080p) [5FFF934E].mkv')
		).toEqual({ season: 4, episodes: [23] });
	});

	it('does not read a CRC as an episode', () => {
		expect(
			animeEpisodesNamed(
				'[Erai-raws] Uramichi Onii-san - 08 [v0][540p][Multiple Subtitle][E827D70E].mkv'
			)
		).toEqual({ season: null, episodes: [8] });
		expect(animeEpisodesNamed('[HR] Ansatsu Kizoku S01E07 [E7AEB08D].mkv').episodes).toEqual([
			7,
		]);
	});

	it('reads a range as more than one episode and a pack as none', () => {
		expect(
			animeEpisodesNamed(
				'[Erai-raws] Sousou no Frieren - 01 ~ 28 [1080p][HEVC][BATCH][Multiple Subtitle]'
			).episodes
		).toEqual([1, 28]);
		expect(
			animeEpisodesNamed(
				'Frieren Beyond Journeys End S01E01-E04 1080p CR WEB-DL AAC2.0 H 264-VARYG'
			).episodes
		).toEqual([1, 4]);
		expect(
			animeEpisodesNamed(
				"[CR] Sousou no Frieren - Beyond Journey's End - Season 01 - Multi-Audio"
			).episodes
		).toEqual([]);
	});

	it('reads absolute numbering and ignores the resolution after it', () => {
		const onePiece = episodeReleases.releases.find((r) => r.key === 'anime:anidb-69')!;
		expect(animeEpisodesNamed(onePiece.filename)).toEqual({ season: null, episodes: [1100] });
	});
});

describe('filterAnimeTroveCandidates', () => {
	it('offers only releases of the requested episode from Frieren’s 772 stored releases', () => {
		const candidates = filterAnimeTroveCandidates(frierenReleases, { episode: 5 });

		expect(candidates.length).toBeGreaterThan(5);
		for (const candidate of candidates) {
			expect(animeEpisodesNamed(candidate.title).episodes).toEqual([5]);
		}
		expect(candidates.map((c) => c.title)).toContain(
			'[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv'
		);
		// Biggest first, one per size.
		const sizes = candidates.map((c) => c.sizeMb);
		expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
		expect(new Set(sizes.map(Math.round)).size).toBe(sizes.length);
	});

	it('finds releases for every one of the 28 episodes Stremio lists', () => {
		for (const video of seriesMeta.meta.videos) {
			expect(
				filterAnimeTroveCandidates(frierenReleases, { episode: video.episode }).length,
				`episode ${video.episode}`
			).toBeGreaterThan(0);
		}
	});

	it('drops a stray first-season title from an entry whose releases say season 4', () => {
		const titles = filterAnimeTroveCandidates(bookwormReleases, { episode: 23 }).map(
			(c) => c.title
		);
		expect(titles).toContain(
			'[SubsPlease] Honzuki no Gekokujou S4 - 23 (1080p) [5FFF934E].mkv'
		);
		expect(titles.some((t) => /S01E23/.test(t))).toBe(false);
	});

	it('offers a film every release, within the size setting', () => {
		const all = filterAnimeTroveCandidates(frierenReleases, { episode: null });
		const capped = filterAnimeTroveCandidates(frierenReleases, { episode: null, maxSizeGb: 1 });

		expect(all.length).toBeGreaterThan(capped.length);
		expect(capped.every((c) => c.sizeMb <= 1024)).toBe(true);
	});
});

describe('resolveStreamTarget', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAnime.mockResolvedValue(FRIEREN_ROW);
		mockGetAll.mockImplementation(async (key: string) =>
			key === 'anime:anidb-17617' ? frierenReleases : null
		);
	});

	it('maps a Kitsu episode to the cast key the anime cast route writes', async () => {
		const target = await resolveStreamTarget('kitsu:46474:5', 'series', 'https://dmm.test');

		expect(mockGetAnime).toHaveBeenCalledWith('kitsu', 46474);
		expect(target).toMatchObject({
			castKey: 'anidb-17617:1:5',
			typeSlug: 'show',
			externalUrl: 'https://dmm.test/anime/17617',
		});
	});

	it('reads both release rows a title can have and filters them to the episode', async () => {
		const target = await resolveStreamTarget('mal:52991:5', 'series', 'https://dmm.test');
		const trove = await target!.trove(undefined);

		expect(mockGetAll).toHaveBeenCalledWith('anime:anidb-17617');
		expect(mockGetAll).toHaveBeenCalledWith('anime:mal-52991');
		expect(trove.length).toBeGreaterThan(0);
		expect(trove.every((c) => animeEpisodesNamed(c.title).episodes[0] === 5)).toBe(true);
	});

	it('needs no row for an anidb id', async () => {
		mockGetAnime.mockResolvedValue(null);
		const target = await resolveStreamTarget('anidb:17617:3', 'series', 'https://dmm.test');
		expect(target?.castKey).toBe('anidb-17617:1:3');
	});

	it('has nothing to offer for a Kitsu id the table does not know', async () => {
		mockGetAnime.mockResolvedValue(null);
		expect(
			await resolveStreamTarget('kitsu:99999999:1', 'series', 'https://dmm.test')
		).toBeNull();
	});

	it('keeps an IMDb id on its existing key, page and trove', async () => {
		const target = await resolveStreamTarget('tt22248376:1:5', 'series', 'https://dmm.test');
		await target!.trove(4);

		expect(target).toMatchObject({
			castKey: 'tt22248376:1:5',
			typeSlug: 'show',
			externalUrl: 'https://dmm.test/show/tt22248376/1',
		});
		expect(mockGetTrove).toHaveBeenCalledWith({
			mediaType: 'series',
			imdbId: 'tt22248376:1:5',
			maxSizeGb: 4,
		});
		expect(mockGetAnime).not.toHaveBeenCalled();
	});
});
