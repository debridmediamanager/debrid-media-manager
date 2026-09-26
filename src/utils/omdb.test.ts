import episodeOmdb from '@/test/fixtures/metadata/omdb-tt21958588-bake-off-episode.json';
import {
	getOmdbMetadata,
	getOmdbParentSeries,
	getOmdbPoster,
	getOmdbRating,
	omdbField,
} from '@/utils/omdb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/metadataCache', () => ({
	getMetadataCache: vi.fn(),
}));

import { getMetadataCache } from '@/services/metadataCache';

describe('omdbField', () => {
	it('treats OMDb’s "N/A" filler as an absent value', () => {
		expect(omdbField('N/A')).toBeUndefined();
	});

	it('treats empty and whitespace-only values as absent', () => {
		expect(omdbField('')).toBeUndefined();
		expect(omdbField('   ')).toBeUndefined();
		expect(omdbField(undefined)).toBeUndefined();
	});

	it('returns real values trimmed', () => {
		expect(omdbField('  Breaking Bad  ')).toBe('Breaking Bad');
	});
});

describe('getOmdbMetadata', () => {
	const mockMetadataCache = { getOmdbInfo: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getMetadataCache).mockReturnValue(mockMetadataCache as any);
	});

	it('returns the payload when OMDb has the title', async () => {
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'True',
			Title: 'Guardians of the Galaxy: Vol. 2',
		});

		await expect(getOmdbMetadata('tt3896198')).resolves.toMatchObject({
			Title: 'Guardians of the Galaxy: Vol. 2',
		});
	});

	it('returns null for an unknown id, which OMDb reports as HTTP 200 + Response:"False"', async () => {
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'False',
			Error: 'Incorrect IMDb ID.',
		});

		await expect(getOmdbMetadata('tt99999999')).resolves.toBeNull();
	});

	it('returns null instead of throwing when the key is missing or rejected', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockMetadataCache.getOmdbInfo.mockRejectedValue(
			new Error('OMDB_KEY environment variable is not set')
		);

		await expect(getOmdbMetadata('tt3896198')).resolves.toBeNull();
		warn.mockRestore();
	});
});

describe('getOmdbPoster', () => {
	it('returns the Amazon-hosted poster URL', () => {
		expect(getOmdbPoster({ Poster: 'https://m.media-amazon.com/images/M/abc.jpg' })).toBe(
			'https://m.media-amazon.com/images/M/abc.jpg'
		);
	});

	it('rejects "N/A" rather than passing it off as a URL', () => {
		expect(getOmdbPoster({ Poster: 'N/A' })).toBeNull();
	});

	it('rejects anything that is not an http URL', () => {
		expect(getOmdbPoster({ Poster: 'not-a-url' })).toBeNull();
		expect(getOmdbPoster(null)).toBeNull();
	});
});

describe('getOmdbRating', () => {
	it('returns the rating on OMDb’s native 0-10 scale', () => {
		expect(getOmdbRating({ imdbRating: '7.6' })).toBe(7.6);
	});

	it('returns null when OMDb has no rating', () => {
		expect(getOmdbRating({ imdbRating: 'N/A' })).toBeNull();
		expect(getOmdbRating(null)).toBeNull();
	});
});

describe('getOmdbParentSeries', () => {
	it('names the series of an episode id', () => {
		expect(getOmdbParentSeries(episodeOmdb, 'tt21958588')).toBe('tt1877368');
	});

	it('names none for a series, an unknown id or a malformed parent', () => {
		expect(getOmdbParentSeries({ Type: 'series', seriesID: 'tt1' }, 'tt2')).toBeNull();
		expect(getOmdbParentSeries(null, 'tt2')).toBeNull();
		expect(getOmdbParentSeries({ Type: 'episode', seriesID: 'N/A' }, 'tt2')).toBeNull();
		expect(getOmdbParentSeries({ Type: 'episode', seriesID: 'tt2' }, 'tt2')).toBeNull();
	});
});
