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

	it('honors the size ceiling', () => {
		const out = filterTroveCandidates(
			rows(['aaa', 'Big.Movie.2160p', 9000], ['ccc', 'Mid.Movie.1080p', 5000]),
			{ mediaType: 'movie', imdbId: 'tt123', maxSizeMb: 6000 }
		);

		expect(out.map((c) => c.hash)).toEqual(['ccc']);
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
