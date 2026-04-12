import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanTvScrapes } from './tvCleaner';

const {
	filterByTvConditionsMock,
	getAllPossibleTitlesMock,
	getSeasonNameAndCodeMock,
	getSeasonYearMock,
	grabTvMetadataMock,
	meetsTitleConditionsMock,
	padWithZeroMock,
	flattenAndRemoveDuplicatesMock,
	sortByFileSizeMock,
} = vi.hoisted(() => ({
	filterByTvConditionsMock: vi.fn(),
	getAllPossibleTitlesMock: vi.fn(),
	getSeasonNameAndCodeMock: vi.fn(),
	getSeasonYearMock: vi.fn(),
	grabTvMetadataMock: vi.fn(),
	meetsTitleConditionsMock: vi.fn(),
	padWithZeroMock: vi.fn(),
	flattenAndRemoveDuplicatesMock: vi.fn(),
	sortByFileSizeMock: vi.fn(),
}));

vi.mock('./mdblistClient', () => ({
	getMdblistClient: vi.fn(() => ({})),
}));

vi.mock('@/utils/checks', () => ({
	filterByTvConditions: filterByTvConditionsMock,
	getAllPossibleTitles: getAllPossibleTitlesMock,
	getSeasonNameAndCode: getSeasonNameAndCodeMock,
	getSeasonYear: getSeasonYearMock,
	grabTvMetadata: grabTvMetadataMock,
	meetsTitleConditions: meetsTitleConditionsMock,
	padWithZero: padWithZeroMock,
}));

vi.mock('./mediasearch', () => ({
	flattenAndRemoveDuplicates: flattenAndRemoveDuplicatesMock,
	sortByFileSize: sortByFileSizeMock,
}));

describe('cleanTvScrapes', () => {
	const db = {
		getScrapedResults: vi.fn(),
		saveScrapedResults: vi.fn(),
		markAsDone: vi.fn(),
	} as unknown as any;

	const season = { season_number: 1, air_date: '2024-01-01' };
	const metadata = {
		cleanTitle: 'Show',
		originalTitle: 'Show',
		titleWithSymbols: 'Show!',
		alternativeTitle: 'Alt',
		cleanedTitle: 'Show',
		year: '2024',
		seasons: [season],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		grabTvMetadataMock.mockReturnValue(metadata);
		getAllPossibleTitlesMock.mockReturnValue(['Show']);
		getSeasonNameAndCodeMock.mockReturnValue({ seasonName: 'Season 1', seasonCode: 1 });
		getSeasonYearMock.mockReturnValue('2024');
		meetsTitleConditionsMock.mockReturnValue(true);
		padWithZeroMock.mockImplementation((value: number) => value.toString().padStart(2, '0'));
		flattenAndRemoveDuplicatesMock.mockImplementation((value) => value.flat());
		sortByFileSizeMock.mockImplementation((value) => value);
		db.getScrapedResults = vi.fn();
		db.saveScrapedResults = vi.fn();
		db.markAsDone = vi.fn();
	});

	it('returns early when there are no scrapes for a season', async () => {
		db.getScrapedResults.mockResolvedValueOnce(undefined);

		await cleanTvScrapes('tt', {}, {}, db);
		expect(filterByTvConditionsMock).not.toHaveBeenCalled();
	});

	it('logs when a season has zero stored scrapes', async () => {
		db.getScrapedResults.mockResolvedValueOnce([]);
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await cleanTvScrapes('tt', {}, {}, db);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No results for'));
	});

	it('persists empty scrapes when filters remove everything', async () => {
		const scrapes = [{ title: 'Show', hash: '1' }];
		db.getScrapedResults.mockResolvedValueOnce(scrapes);
		filterByTvConditionsMock.mockReturnValue([]);
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await cleanTvScrapes('tt', {}, {}, db);

		expect(db.saveScrapedResults).toHaveBeenCalledWith('tv:tt:1', [], false, true);
		expect(db.markAsDone).toHaveBeenCalledWith('tt');
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('Preliminary procedure removed')
		);
	});

	it('logs removal counts when processed scrapes shrink', async () => {
		const scrapes = [
			{ title: 'Show', hash: '1' },
			{ title: 'Show 2', hash: '2' },
		];
		db.getScrapedResults.mockResolvedValueOnce(scrapes);
		filterByTvConditionsMock.mockReturnValue(scrapes);
		flattenAndRemoveDuplicatesMock.mockReturnValue([[scrapes[0]]]);
		sortByFileSizeMock.mockReturnValue([scrapes[0]]);
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await cleanTvScrapes('tt', {}, {}, db);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Removed 1'));
	});

	it('logs when every scrape passes the cleaning stage', async () => {
		const scrapes = [{ title: 'Show', hash: '1' }];
		db.getScrapedResults.mockResolvedValueOnce(scrapes);
		filterByTvConditionsMock.mockReturnValue(scrapes);
		flattenAndRemoveDuplicatesMock.mockReturnValue([scrapes]);
		sortByFileSizeMock.mockReturnValue(scrapes);
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await cleanTvScrapes('tt', {}, {}, db);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Retained'));
	});
});
