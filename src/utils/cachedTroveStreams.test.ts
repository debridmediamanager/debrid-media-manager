import type { ScrapeSearchResult } from '@/services/mediasearch';
import { repository } from '@/services/repository';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterTroveCandidates, getTroveCandidates } from './cachedTroveStreams';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

const rows = (...entries: [hash: string, title: string, fileSize: number][]) =>
	entries.map(([hash, title, fileSize]) => ({ hash, title, fileSize }));

describe('filterTroveCandidates', () => {
	it('passes movie releases through biggest-first with junk filtered', () => {
		const out = filterTroveCandidates(
			rows(
				['aaa', 'Small.Movie.1080p', 5],
				['bbb', 'Big.Movie.2160p', 9000],
				['ccc', 'Mid.Movie.1080p', 5000]
			),
			{ mediaType: 'movie', imdbId: 'tt123' }
		);

		expect(out.map((c) => c.hash)).toEqual(['bbb', 'ccc']);
	});

	it('honors the size ceiling, set in GB against MB file sizes', () => {
		const out = filterTroveCandidates(
			rows(
				['aaa', 'Big.Movie.2160p', 9000],
				['bbb', 'Over.Movie.2160p', 20000],
				['ccc', 'Mid.Movie.1080p', 5000]
			),
			// The settings select stores GB; 15 GB = 15360 MB keeps the ~9 GB
			// release and drops the ~20 GB one. This pins the unit: the first
			// version of the ceiling compared the GB value against MB sizes and
			// filtered out everything the moment a limit was set.
			{ mediaType: 'movie', imdbId: 'tt123', maxSizeGb: 15 }
		);

		expect(out.map((c) => c.hash)).toEqual(['aaa', 'ccc']);
	});

	it('drops scraper unit noise: a 1080p WEBRip stored as 28 TB', () => {
		const out = filterTroveCandidates(
			rows(
				['aaa', 'Movie.2026.1080p.WEBRip.x265-DH', 29000000],
				['bbb', 'Movie.2026.2160p.REMUX', 80000]
			),
			{ mediaType: 'movie', imdbId: 'tt123' }
		);

		expect(out.map((c) => c.hash)).toEqual(['bbb']);
	});

	it('hides Cyrillic-leading titles, like the detail page does', () => {
		const out = filterTroveCandidates(
			rows(
				['aaa', 'Проект «Конец света» / Movie (2026) UHD BDRemux', 80000],
				['bbb', 'Movie.2026.2160p.REMUX', 70000]
			),
			{ mediaType: 'movie', imdbId: 'tt123' }
		);

		expect(out.map((c) => c.hash)).toEqual(['bbb']);
	});

	it('keeps one release per size: the same encode scraped under two infohashes', () => {
		const out = filterTroveCandidates(
			rows(
				['aaa', 'Movie.2026.WEBRip.1080p.H264.DD51.mkv', 18972.83],
				['bbb', 'Movie.2026.WEBRip.1080p.H264.DD51.mkv', 18972.84],
				['ccc', 'Movie.2026.2160p.WEB-DL', 55000]
			),
			{ mediaType: 'movie', imdbId: 'tt123' }
		);

		expect(out.map((c) => c.hash)).toEqual(['ccc', 'aaa']);
	});

	it('caps the candidate count after sorting', () => {
		const out = filterTroveCandidates(
			rows(['aaa', 'A', 100], ['bbb', 'B', 300], ['ccc', 'C', 200]),
			{ mediaType: 'movie', imdbId: 'tt123', maxCount: 2 }
		);

		expect(out.map((c) => c.hash)).toEqual(['bbb', 'ccc']);
	});

	it('keeps only releases naming the exact episode for series', () => {
		const out = filterTroveCandidates(
			rows(
				['aaa', 'Show.S01E02.1080p.WEB.h265', 4000],
				['bbb', 'Show.S01E03.1080p.WEB.h265', 4000],
				['ccc', 'Show.S01.Complete.Season.1080p', 40000],
				['ddd', 'Show.1080p.BluRay', 9000]
			),
			{ mediaType: 'series', imdbId: 'tt500:1:2' }
		);

		expect(out.map((c) => c.hash)).toEqual(['aaa']);
	});

	it('rejects a series id without season and episode', () => {
		const out = filterTroveCandidates(rows(['aaa', 'Show.S01E02.1080p', 4000]), {
			mediaType: 'series',
			imdbId: 'tt500:1',
		});

		expect(out).toEqual([]);
	});

	it('returns nothing for a missing or empty row', () => {
		expect(filterTroveCandidates(null, { mediaType: 'movie', imdbId: 'tt1' })).toEqual([]);
		expect(filterTroveCandidates([], { mediaType: 'movie', imdbId: 'tt1' })).toEqual([]);
	});
});

describe('getTroveCandidates', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reads the movie page key', async () => {
		mockRepository.getAllScrapedTrueResults = vi
			.fn()
			.mockResolvedValue(rows(['aaa', 'Movie.1080p', 4000]) as ScrapeSearchResult[]);

		const out = await getTroveCandidates({ mediaType: 'movie', imdbId: 'tt123' });

		expect(mockRepository.getAllScrapedTrueResults).toHaveBeenCalledWith('movie:tt123');
		expect(out.map((c) => c.hash)).toEqual(['aaa']);
	});

	it('reads the season page key for a series episode', async () => {
		mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(null);

		await getTroveCandidates({ mediaType: 'series', imdbId: 'tt500:2:7' });

		expect(mockRepository.getAllScrapedTrueResults).toHaveBeenCalledWith('tv:tt500:2');
	});
});
