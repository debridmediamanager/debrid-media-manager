import { repository } from '@/services/repository';
import {
	MAX_UNSPECIFIED_SEASONS,
	normalizeImdbId,
	parseQueryTitle,
	resolveTargets,
} from '@/services/torznab/resolve';
import { resolveImdbIdFromTvdbId } from '@/services/tvdbLookup';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/tvdbLookup', () => ({ resolveImdbIdFromTvdbId: vi.fn() }));

const mockRepo = vi.mocked(repository);
const mockTvdb = vi.mocked(resolveImdbIdFromTvdbId);

beforeEach(() => {
	vi.clearAllMocks();
	mockRepo.getScrapedTrueSeasonKeys = vi.fn().mockResolvedValue([]);
	mockRepo.getImdbTitleById = vi.fn().mockResolvedValue(null);
	mockRepo.searchImdbTitles = vi.fn().mockResolvedValue([]);
	mockTvdb.mockResolvedValue(undefined);
});

describe('normalizeImdbId', () => {
	it('accepts both forms clients send', () => {
		expect(normalizeImdbId('tt0111161')).toBe('tt0111161');
		expect(normalizeImdbId('0111161')).toBe('tt0111161');
		expect(normalizeImdbId('TT0111161')).toBe('tt0111161');
	});

	it('restores the padding Prowlarr strips', () => {
		// `tt111161` is a different title from `tt0111161`, and only one of them
		// is a key in this database.
		expect(normalizeImdbId('111161')).toBe('tt0111161');
	});

	it('leaves the newer eight-digit ids alone', () => {
		expect(normalizeImdbId('tt40000000')).toBe('tt40000000');
	});

	it('rejects anything that is not an id', () => {
		expect(normalizeImdbId('')).toBeNull();
		expect(normalizeImdbId('tt')).toBeNull();
		expect(normalizeImdbId('tt12ab34')).toBeNull();
	});
});

describe('parseQueryTitle', () => {
	it('strips the season and episode tokens a manual search carries', () => {
		expect(parseQueryTitle('The Wire S01E03')).toEqual({ title: 'The Wire' });
		expect(parseQueryTitle('The Wire 1x03')).toEqual({ title: 'The Wire' });
		expect(parseQueryTitle('The Wire Season 2')).toEqual({ title: 'The Wire' });
	});

	it('takes a trailing year as a year', () => {
		expect(parseQueryTitle('Dune 2021')).toEqual({ title: 'Dune', year: 2021 });
		expect(parseQueryTitle('Dune (2021)')).toEqual({ title: 'Dune', year: 2021 });
	});

	it('leaves a year-shaped word that is part of the title', () => {
		// The one that matters: 2049 is not a release year, it is the film.
		expect(parseQueryTitle('Blade Runner 2049')).toEqual({ title: 'Blade Runner 2049' });
	});

	it('normalises punctuation into the shape the index is keyed on', () => {
		expect(parseQueryTitle('Spider-Man: No Way Home')).toEqual({
			title: 'Spider Man No Way Home',
		});
	});
});

describe('resolveTargets', () => {
	it('maps a movie search to the movie page', async () => {
		expect(await resolveTargets('movie', { imdbid: '0111161' })).toEqual([
			{ kind: 'movie', imdbId: 'tt0111161', key: 'movie:tt0111161' },
		]);
	});

	it('maps a TV search with a season to that season page', async () => {
		expect(await resolveTargets('tvsearch', { imdbid: 'tt0903747', season: 3 })).toEqual([
			{ kind: 'tv', imdbId: 'tt0903747', season: 3, key: 'tv:tt0903747:3' },
		]);
		expect(mockRepo.getScrapedTrueSeasonKeys).not.toHaveBeenCalled();
	});

	it('reads a bounded number of season pages when a TV search names none', async () => {
		// In the order the repository hands them over, which is most recently
		// refreshed first — a show with a mis-parsed season 72 must not answer
		// with it just because 72 is the highest number.
		mockRepo.getScrapedTrueSeasonKeys = vi
			.fn()
			.mockResolvedValue([
				'tv:tt0903747:5',
				'tv:tt0903747:3',
				'tv:tt0903747:4',
				'tv:tt0903747:72',
			]);

		const targets = await resolveTargets('tvsearch', { imdbid: 'tt0903747' });

		expect(targets).toHaveLength(MAX_UNSPECIFIED_SEASONS);
		expect(targets.map((target) => target.season)).toEqual([5, 3, 4]);
	});

	it('names season 1 for a show with no pages yet, so a backfill has a target', async () => {
		expect(await resolveTargets('tvsearch', { imdbid: 'tt9999999' })).toEqual([
			{ kind: 'tv', imdbId: 'tt9999999', season: 1, key: 'tv:tt9999999:1' },
		]);
	});

	it('asks the IMDb index what kind an id is when the search type does not say', async () => {
		mockRepo.getImdbTitleById = vi
			.fn()
			.mockResolvedValue({ imdbId: 'tt0903747', type: 'show' });
		mockRepo.getScrapedTrueSeasonKeys = vi.fn().mockResolvedValue(['tv:tt0903747:1']);

		const targets = await resolveTargets('search', { imdbid: 'tt0903747' });

		expect(targets).toEqual([
			{ kind: 'tv', imdbId: 'tt0903747', season: 1, key: 'tv:tt0903747:1' },
		]);
	});

	it('considers both kinds for an id the IMDb index has never heard of', async () => {
		mockRepo.getScrapedTrueSeasonKeys = vi.fn().mockResolvedValue(['tv:tt1234567:2']);

		const targets = await resolveTargets('search', { imdbid: 'tt1234567' });

		expect(targets.map((target) => target.key)).toEqual(['movie:tt1234567', 'tv:tt1234567:2']);
	});

	it('translates a TVDB id, which is all Sonarr sends for some series', async () => {
		mockTvdb.mockResolvedValue('tt0903747');

		const targets = await resolveTargets('tvsearch', { tvdbid: 81189, season: 1 });

		expect(mockTvdb).toHaveBeenCalledWith(81189);
		expect(targets).toEqual([
			{ kind: 'tv', imdbId: 'tt0903747', season: 1, key: 'tv:tt0903747:1' },
		]);
	});

	it('prefers an IMDb id over a TVDB id when both arrive', async () => {
		await resolveTargets('tvsearch', { imdbid: 'tt0903747', tvdbid: 81189, season: 1 });
		expect(mockTvdb).not.toHaveBeenCalled();
	});

	it('falls back to a title search when the TVDB mapping is unknown', async () => {
		mockRepo.searchImdbTitles = vi
			.fn()
			.mockResolvedValue([{ imdbId: 'tt0903747', type: 'show' }]);

		const targets = await resolveTargets('tvsearch', {
			tvdbid: 81189,
			q: 'Breaking Bad',
			season: 1,
		});

		expect(targets).toEqual([
			{ kind: 'tv', imdbId: 'tt0903747', season: 1, key: 'tv:tt0903747:1' },
		]);
	});

	it('lets the matched title decide the kind on a generic search', async () => {
		mockRepo.searchImdbTitles = vi
			.fn()
			.mockResolvedValue([{ imdbId: 'tt0111161', type: 'movie' }]);

		expect(await resolveTargets('search', { q: 'The Shawshank Redemption 1994' })).toEqual([
			{ kind: 'movie', imdbId: 'tt0111161', key: 'movie:tt0111161' },
		]);
		expect(mockRepo.searchImdbTitles).toHaveBeenCalledWith('The Shawshank Redemption', {
			limit: 1,
			year: 1994,
			mediaType: undefined,
		});
	});

	it('lets a category-scoped manual search say which kind it means', async () => {
		// Prowlarr sends `t=search` plus the categories a person ticked. A search
		// scoped to Movies has no business matching a series of the same name.
		mockRepo.searchImdbTitles = vi
			.fn()
			.mockResolvedValue([{ imdbId: 'tt0111161', type: 'movie' }]);

		await resolveTargets('search', { q: 'Shawshank', categories: [2000, 2040] });

		expect(mockRepo.searchImdbTitles).toHaveBeenCalledWith('Shawshank', {
			limit: 1,
			year: undefined,
			mediaType: 'movie',
		});
	});

	it('ignores a mixed category filter, which states nothing', async () => {
		mockRepo.searchImdbTitles = vi
			.fn()
			.mockResolvedValue([{ imdbId: 'tt0111161', type: 'movie' }]);

		await resolveTargets('search', { q: 'Shawshank', categories: [2000, 5000] });

		expect(mockRepo.searchImdbTitles).toHaveBeenCalledWith('Shawshank', {
			limit: 1,
			year: undefined,
			mediaType: undefined,
		});
	});

	it('answers nothing when neither an id nor a title resolves', async () => {
		expect(await resolveTargets('search', {})).toEqual([]);
		expect(await resolveTargets('search', { q: 'nothing matches this' })).toEqual([]);
		expect(await resolveTargets('movie', { imdbid: 'not-an-id' })).toEqual([]);
	});
});
