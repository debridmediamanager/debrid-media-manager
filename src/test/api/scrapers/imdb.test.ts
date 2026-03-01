import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const scrapeMocks = vi.hoisted(() => ({
	generateScrapeJobs: vi.fn(),
}));

vi.mock('@/scrapers/scrapeJobs', () => scrapeMocks);

import handler from '@/pages/api/scrapers/imdb';

const originalEnv = { ...process.env };
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

const createRes = () => {
	const res: any = {
		status: vi.fn().mockReturnThis(),
		json: vi.fn(),
		redirect: vi.fn(),
	};
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv, JACKETT: '1', PROWLARR: '1' };
});

afterAll(() => {
	exitSpy.mockRestore();
	process.env = originalEnv;
});

describe('API /api/scrapers/imdb', () => {
	it('rejects requests when indexers are not configured', async () => {
		process.env.JACKETT = '';
		const res = createRes();

		await handler({ query: {} } as any, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ status: 'failed' });
	});

	it('validates the imdb id', async () => {
		const res = createRes();
		await handler({ query: {} } as any, res);
		expect(res.status).toHaveBeenCalledWith(400);

		const res2 = createRes();
		await handler({ query: { id: '123' } } as any, res2);
		expect(res2.status).toHaveBeenCalledWith(400);
	});

	it('launches scrape jobs with normalized parameters', async () => {
		const res = createRes();
		await handler(
			{
				query: {
					id: 'tt1234567',
					season: '2',
					lastSeason: 'false',
					replaceOldScrape: 'true',
				},
				headers: { 'x-real-ip': '1.1.1.1' },
			} as any,
			res
		);

		expect(scrapeMocks.generateScrapeJobs).toHaveBeenCalledWith('tt1234567', 2, true);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ status: 'success' });
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	it('scrapes the last season when requested', async () => {
		const res = createRes();
		await handler(
			{
				query: {
					id: 'tt7654321',
					lastSeason: 'true',
					replaceOldScrape: 'false',
				},
			} as any,
			res
		);

		expect(scrapeMocks.generateScrapeJobs).toHaveBeenCalledWith('tt7654321', -1, false);
	});
});
