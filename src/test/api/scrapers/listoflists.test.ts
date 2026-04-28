import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const scrapeJobsMocks = vi.hoisted(() => ({
	generateScrapeJobs: vi.fn(),
}));

const repositoryMocks = vi.hoisted(() => ({
	repository: {
		keyExists: vi.fn(),
		isOlderThan: vi.fn(),
	},
}));

const scrapeInputMocks = vi.hoisted(() => ({
	ScrapeInput: vi.fn(),
}));

vi.mock('@/scrapers/scrapeJobs', () => scrapeJobsMocks);
vi.mock('@/services/repository', () => repositoryMocks);
vi.mock('@/scrapers/scrapeInput', () => scrapeInputMocks);

import handler from '@/pages/api/scrapers/listoflists';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

const originalEnv = { ...process.env };
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

function makeAsyncIterator<T>(items: T[]): AsyncIterableIterator<T> {
	let index = 0;
	return {
		[Symbol.asyncIterator]() {
			return this;
		},
		async next() {
			if (index < items.length) {
				return { value: items[index++], done: false };
			}
			return { value: undefined as unknown as T, done: true };
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv, JACKETT: '1', PROWLARR: '1' };
	scrapeInputMocks.ScrapeInput.mockImplementation(() => ({
		byLists: vi.fn(),
		byListId: vi.fn(),
	}));
});

afterAll(() => {
	exitSpy.mockRestore();
	process.env = originalEnv;
});

describe('API /api/scrapers/listoflists', () => {
	it('returns 403 when env vars not set', async () => {
		process.env.JACKETT = '';
		process.env.PROWLARR = '';
		const req = createMockRequest({ query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ status: 'failed' });
	});

	it('returns 403 when only JACKETT is missing', async () => {
		delete process.env.JACKETT;
		const req = createMockRequest({ query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
	});

	it('returns 400 when search is missing', async () => {
		const req = createMockRequest({ query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'You must provide a search term',
		});
	});

	it('returns 400 when search is an array', async () => {
		const req = createMockRequest({ query: { search: ['a', 'b'] as unknown as string } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('processes lists and generates scrape jobs', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const byListsMock = vi.fn().mockReturnValue(makeAsyncIterator(['list-1']));
		const byListIdMock = vi.fn().mockReturnValue(makeAsyncIterator(['tt1234567']));
		scrapeInputMocks.ScrapeInput.mockImplementation(() => ({
			byLists: byListsMock,
			byListId: byListIdMock,
		}));
		repositoryMocks.repository.keyExists.mockResolvedValue(false);
		repositoryMocks.repository.isOlderThan.mockResolvedValue(true);
		scrapeJobsMocks.generateScrapeJobs.mockResolvedValue(undefined);

		const req = createMockRequest({ query: { search: 'movies' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(byListsMock).toHaveBeenCalledWith('movies');
		expect(byListIdMock).toHaveBeenCalledWith('list-1');
		expect(scrapeJobsMocks.generateScrapeJobs).toHaveBeenCalledWith('tt1234567');
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	it('skips already-processing IDs', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const byListsMock = vi.fn().mockReturnValue(makeAsyncIterator(['list-1']));
		const byListIdMock = vi.fn().mockReturnValue(makeAsyncIterator(['tt1111111']));
		scrapeInputMocks.ScrapeInput.mockImplementation(() => ({
			byLists: byListsMock,
			byListId: byListIdMock,
		}));
		repositoryMocks.repository.keyExists.mockResolvedValue(true);

		const req = createMockRequest({ query: { search: 'movies' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(repositoryMocks.repository.keyExists).toHaveBeenCalledWith('processing:tt1111111');
		expect(scrapeJobsMocks.generateScrapeJobs).not.toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	it('skips recently-scraped IDs', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const byListsMock = vi.fn().mockReturnValue(makeAsyncIterator(['list-1']));
		const byListIdMock = vi.fn().mockReturnValue(makeAsyncIterator(['tt2222222']));
		scrapeInputMocks.ScrapeInput.mockImplementation(() => ({
			byLists: byListsMock,
			byListId: byListIdMock,
		}));
		repositoryMocks.repository.keyExists.mockResolvedValue(false);
		repositoryMocks.repository.isOlderThan.mockResolvedValue(false);

		const req = createMockRequest({ query: { search: 'movies', skipMs: '0' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(repositoryMocks.repository.isOlderThan).toHaveBeenCalledWith('tt2222222', 10);
		expect(scrapeJobsMocks.generateScrapeJobs).not.toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	it('skips non-tt IMDB IDs', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const byListsMock = vi.fn().mockReturnValue(makeAsyncIterator(['list-1']));
		const byListIdMock = vi.fn().mockReturnValue(makeAsyncIterator(['nm1234567']));
		scrapeInputMocks.ScrapeInput.mockImplementation(() => ({
			byLists: byListsMock,
			byListId: byListIdMock,
		}));

		const req = createMockRequest({ query: { search: 'movies' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(repositoryMocks.repository.keyExists).not.toHaveBeenCalled();
		expect(scrapeJobsMocks.generateScrapeJobs).not.toHaveBeenCalled();
	});

	it('batches IDs according to quantity param', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const byListsMock = vi.fn().mockReturnValue(makeAsyncIterator(['list-1']));
		const byListIdMock = vi
			.fn()
			.mockReturnValue(makeAsyncIterator(['tt0000001', 'tt0000002', 'tt0000003']));
		scrapeInputMocks.ScrapeInput.mockImplementation(() => ({
			byLists: byListsMock,
			byListId: byListIdMock,
		}));
		repositoryMocks.repository.keyExists.mockResolvedValue(false);
		repositoryMocks.repository.isOlderThan.mockResolvedValue(true);
		scrapeJobsMocks.generateScrapeJobs.mockResolvedValue(undefined);

		const req = createMockRequest({ query: { search: 'movies', quantity: '2' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(scrapeJobsMocks.generateScrapeJobs).toHaveBeenCalledTimes(3);
	});

	it('respects custom rescrapeIfXDaysOld param', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const byListsMock = vi.fn().mockReturnValue(makeAsyncIterator(['list-1']));
		const byListIdMock = vi.fn().mockReturnValue(makeAsyncIterator(['tt5555555']));
		scrapeInputMocks.ScrapeInput.mockImplementation(() => ({
			byLists: byListsMock,
			byListId: byListIdMock,
		}));
		repositoryMocks.repository.keyExists.mockResolvedValue(false);
		repositoryMocks.repository.isOlderThan.mockResolvedValue(true);
		scrapeJobsMocks.generateScrapeJobs.mockResolvedValue(undefined);

		const req = createMockRequest({
			query: { search: 'movies', rescrapeIfXDaysOld: '30' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(repositoryMocks.repository.isOlderThan).toHaveBeenCalledWith('tt5555555', 30);
	});
});
