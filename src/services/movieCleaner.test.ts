import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanMovieScrapes } from './movieCleaner';

const {
	filterByMovieConditionsMock,
	getAllPossibleTitlesMock,
	grabMovieMetadataMock,
	meetsTitleConditionsMock,
	flattenAndRemoveDuplicatesMock,
	sortByFileSizeMock,
} = vi.hoisted(() => ({
	filterByMovieConditionsMock: vi.fn(),
	getAllPossibleTitlesMock: vi.fn(),
	grabMovieMetadataMock: vi.fn(),
	meetsTitleConditionsMock: vi.fn(),
	flattenAndRemoveDuplicatesMock: vi.fn(),
	sortByFileSizeMock: vi.fn(),
}));

vi.mock('./mdblistClient', () => ({
	getMdblistClient: vi.fn(() => ({})),
}));

vi.mock('@/utils/checks', () => ({
	filterByMovieConditions: filterByMovieConditionsMock,
	getAllPossibleTitles: getAllPossibleTitlesMock,
	grabMovieMetadata: grabMovieMetadataMock,
	meetsTitleConditions: meetsTitleConditionsMock,
}));

vi.mock('./mediasearch', () => ({
	flattenAndRemoveDuplicates: flattenAndRemoveDuplicatesMock,
	sortByFileSize: sortByFileSizeMock,
}));

describe('cleanMovieScrapes', () => {
	const db = {
		getScrapedResults: vi.fn(),
	} as unknown as any;
	const defaultMetadata = {
		cleanTitle: 'Movie',
		originalTitle: 'Movie',
		titleWithSymbols: 'Movie!',
		alternativeTitle: 'Alt',
		cleanedTitle: 'Movie',
		year: '2024',
		airDate: '2024-01-01',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		grabMovieMetadataMock.mockReturnValue(defaultMetadata);
		getAllPossibleTitlesMock.mockReturnValue(['Movie']);
		filterByMovieConditionsMock.mockReturnValue([]);
		meetsTitleConditionsMock.mockReturnValue(true);
		flattenAndRemoveDuplicatesMock.mockImplementation((value) => value.flat());
		sortByFileSizeMock.mockImplementation((value) => value);
		db.getScrapedResults = vi.fn();
	});

	it('does nothing when no scrapes are stored', async () => {
		db.getScrapedResults.mockResolvedValue(undefined);

		await cleanMovieScrapes('tt', {}, {}, db);
		expect(filterByMovieConditionsMock).not.toHaveBeenCalled();
	});

	it('logs when an imdb id has zero stored results', async () => {
		db.getScrapedResults.mockResolvedValue([]);
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await cleanMovieScrapes('tt', {}, {}, db);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No results for'));
	});

	it('stops when the preliminary filters remove everything', async () => {
		const scrapes = [{ title: 'Movie', hash: '1' }];
		db.getScrapedResults.mockResolvedValue(scrapes);
		filterByMovieConditionsMock.mockReturnValue([]);
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await cleanMovieScrapes('tt', {}, {}, db);
		expect(flattenAndRemoveDuplicatesMock).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('Preliminary procedure removed')
		);
	});

	it('logs the number of removed scrapes when cleaning succeeds', async () => {
		const scrapes = [
			{ title: 'Movie', hash: '1' },
			{ title: 'Movie 2', hash: '2' },
		];
		db.getScrapedResults.mockResolvedValue(scrapes);
		filterByMovieConditionsMock.mockReturnValue(scrapes);
		flattenAndRemoveDuplicatesMock.mockReturnValue([[scrapes[0]]]);
		sortByFileSizeMock.mockReturnValue([scrapes[0]]);
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await cleanMovieScrapes('tt', {}, {}, db);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Removed 1'));
	});

	it('logs when every scrape survives the cleaning pass', async () => {
		const scrapes = [{ title: 'Movie', hash: '1' }];
		db.getScrapedResults.mockResolvedValue(scrapes);
		filterByMovieConditionsMock.mockReturnValue(scrapes);
		flattenAndRemoveDuplicatesMock.mockReturnValue([scrapes]);
		sortByFileSizeMock.mockReturnValue(scrapes);
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await cleanMovieScrapes('tt', {}, {}, db);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Retained'));
	});
});
