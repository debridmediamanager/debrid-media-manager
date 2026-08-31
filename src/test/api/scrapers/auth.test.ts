import imdbHandler from '@/pages/api/scrapers/imdb';
import listoflistsHandler from '@/pages/api/scrapers/listoflists';
import singlelistHandler from '@/pages/api/scrapers/singlelist';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { NextApiRequest, NextApiResponse } from 'next';
import { MockInstance, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateScrapeJobs } = vi.hoisted(() => ({
	mockGenerateScrapeJobs: vi.fn(),
}));

vi.mock('@/scrapers/scrapeJobs', () => ({
	generateScrapeJobs: mockGenerateScrapeJobs,
}));

// Both list routes walk async generators over mdblist; yielding nothing takes
// them straight to their success response without touching the network.
vi.mock('@/scrapers/scrapeInput', () => ({
	ScrapeInput: class {
		async *byListId() {}
		async *byLists() {}
	},
}));

vi.mock('@/services/repository', () => ({
	repository: {
		keyExists: vi.fn().mockResolvedValue(false),
		isOlderThan: vi.fn().mockResolvedValue(true),
	},
}));

const PASSWORD = 'test-scrape-password-12345';

type Handler = (req: NextApiRequest, res: NextApiResponse<any>) => Promise<void>;

// The query each route needs to reach its success path, so an authorized call is
// exercised end to end rather than stopping at a validation 400.
const routes: Array<{ name: string; handler: Handler; query: Record<string, string> }> = [
	{ name: 'imdb', handler: imdbHandler as Handler, query: { id: 'tt1234567' } },
	{ name: 'singlelist', handler: singlelistHandler as Handler, query: { listId: 'list-1' } },
	{ name: 'listoflists', handler: listoflistsHandler as Handler, query: { search: 'anime' } },
];

describe.each(routes)('/api/scrapers/$name', ({ handler, query }) => {
	const originalEnv = process.env;
	let exitSpy: MockInstance<typeof process.exit>;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = {
			...originalEnv,
			SCRAPE_API_PASSWORD: PASSWORD,
			JACKETT: 'http://jackett',
			PROWLARR: 'http://prowlarr',
		};
		delete process.env.SCRAPE_WORKER;
		mockGenerateScrapeJobs.mockResolvedValue(undefined);
		exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('refuses a caller with no password', async () => {
		const req = createMockRequest({ query });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ status: 'failed' });
		expect(mockGenerateScrapeJobs).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('refuses a caller with the wrong password', async () => {
		const req = createMockRequest({
			query: { ...query, password: 'wrong' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ status: 'failed' });
		expect(mockGenerateScrapeJobs).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
	});

	// Fail closed. Before this gate existed the routes answered anyone, and a
	// missing env var must not quietly restore that.
	it('refuses everyone when SCRAPE_API_PASSWORD is unset', async () => {
		delete process.env.SCRAPE_API_PASSWORD;
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const req = createMockRequest({ query: { ...query, password: PASSWORD } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Server configuration error',
		});
		expect(mockGenerateScrapeJobs).not.toHaveBeenCalled();
	});

	// `scraper.sh` on dmm-01 calls these with a query string, so this transport
	// has to keep working.
	it('proceeds with the correct password in the query string', async () => {
		const req = createMockRequest({ query: { ...query, password: PASSWORD } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ status: 'success' });
	});

	it('proceeds with the correct password in the x-scrape-password header', async () => {
		const req = createMockRequest({
			query,
			headers: { 'x-scrape-password': PASSWORD },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ status: 'success' });
	});

	// The regression test for the remote DoS: these routes are served by the four
	// `dmm_web` swarm replicas as well as by the throwaway worker, and an exit in
	// a replica drops a quarter of the site out of the load balancer. Even a
	// fully authenticated request must not exit without the opt-in.
	it('never exits without SCRAPE_WORKER, even on an authenticated success', async () => {
		const req = createMockRequest({ query: { ...query, password: PASSWORD } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	// The other half: with the flag set the one-shot worker still tears itself
	// down, so a scrape run leaves no orphaned Next process behind.
	it('exits when the process is a one-shot scrape worker', async () => {
		process.env.SCRAPE_WORKER = '1';

		const req = createMockRequest({ query: { ...query, password: PASSWORD } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	// The pre-existing indexer guard must still short-circuit — but only after
	// authentication, so an anonymous caller learns nothing about the config.
	it('keeps the JACKETT/PROWLARR guard behind authentication', async () => {
		delete process.env.JACKETT;

		const anonymous = createMockRequest({ query });
		const anonymousRes = createMockResponse();
		await handler(anonymous, anonymousRes);
		expect(anonymousRes.status).toHaveBeenCalledWith(401);

		const authorized = createMockRequest({ query: { ...query, password: PASSWORD } });
		const authorizedRes = createMockResponse();
		await handler(authorized, authorizedRes);
		expect(authorizedRes.status).toHaveBeenCalledWith(403);
		expect(authorizedRes.json).toHaveBeenCalledWith({ status: 'failed' });
	});
});
