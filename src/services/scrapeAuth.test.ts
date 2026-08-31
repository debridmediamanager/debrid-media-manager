import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeScrapeRequest, exitIfScrapeWorker } from './scrapeAuth';

const PASSWORD = 'test-scrape-password-12345';

describe('authorizeScrapeRequest', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv, SCRAPE_API_PASSWORD: PASSWORD };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('refuses a caller presenting no password', () => {
		const req = createMockRequest();
		const res = createMockResponse();

		expect(authorizeScrapeRequest(req, res)).toBe(false);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ status: 'failed' });
	});

	it('refuses a wrong password from either transport', () => {
		const viaHeader = createMockRequest({ headers: { 'x-scrape-password': 'nope' } });
		const headerRes = createMockResponse();

		expect(authorizeScrapeRequest(viaHeader, headerRes)).toBe(false);
		expect(headerRes.status).toHaveBeenCalledWith(401);

		const viaQuery = createMockRequest({ query: { password: 'nope' } });
		const queryRes = createMockResponse();

		expect(authorizeScrapeRequest(viaQuery, queryRes)).toBe(false);
		expect(queryRes.status).toHaveBeenCalledWith(401);
	});

	// A wrong password of a different length must not take a different code path
	// from a wrong one of the same length — the length guard in front of
	// `timingSafeEqual` is easy to turn into a throw by accident.
	it('refuses a wrong password of a different length without throwing', () => {
		const req = createMockRequest({ headers: { 'x-scrape-password': 'x' } });
		const res = createMockResponse();

		expect(authorizeScrapeRequest(req, res)).toBe(false);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('accepts the correct password in the x-scrape-password header', () => {
		const req = createMockRequest({ headers: { 'x-scrape-password': PASSWORD } });
		const res = createMockResponse();

		expect(authorizeScrapeRequest(req, res)).toBe(true);
		expect(res.status).not.toHaveBeenCalled();
	});

	it('accepts the correct password in the password query param', () => {
		const req = createMockRequest({ query: { password: PASSWORD } });
		const res = createMockResponse();

		expect(authorizeScrapeRequest(req, res)).toBe(true);
		expect(res.status).not.toHaveBeenCalled();
	});

	it('ignores an array-valued query param rather than coercing it', () => {
		const req = createMockRequest({ query: { password: [PASSWORD] } });
		const res = createMockResponse();

		expect(authorizeScrapeRequest(req, res)).toBe(false);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	// Fail closed. An unset variable used to mean "no check at all", which is how
	// these routes ended up answering anonymous callers in production.
	it('refuses everyone when SCRAPE_API_PASSWORD is unset', () => {
		delete process.env.SCRAPE_API_PASSWORD;
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const req = createMockRequest({ headers: { 'x-scrape-password': PASSWORD } });
		const res = createMockResponse();

		expect(authorizeScrapeRequest(req, res)).toBe(false);
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Server configuration error',
		});
		expect(errorSpy).toHaveBeenCalledWith(
			'SCRAPE_API_PASSWORD environment variable is not set'
		);
	});

	it('refuses everyone when SCRAPE_API_PASSWORD is set to an empty string', () => {
		process.env.SCRAPE_API_PASSWORD = '';
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const req = createMockRequest({ headers: { 'x-scrape-password': '' } });
		const res = createMockResponse();

		expect(authorizeScrapeRequest(req, res)).toBe(false);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});

describe('exitIfScrapeWorker', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		delete process.env.SCRAPE_WORKER;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	// The replica-safety half: a `dmm_web` container serves these routes too, and
	// an exit there drops one of four instances out of the load balancer.
	it('does not exit when SCRAPE_WORKER is unset', () => {
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

		exitIfScrapeWorker();

		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('does not exit for any value other than the exact opt-in', () => {
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

		for (const value of ['0', 'true', '', 'yes']) {
			process.env.SCRAPE_WORKER = value;
			exitIfScrapeWorker();
		}

		expect(exitSpy).not.toHaveBeenCalled();
	});

	// The teardown half: without this the throwaway Next instance `scraper.sh`
	// boots per mdblist list never stops, leaking a process and a tmux session.
	it('exits when SCRAPE_WORKER is 1', () => {
		process.env.SCRAPE_WORKER = '1';
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

		exitIfScrapeWorker();

		expect(exitSpy).toHaveBeenCalledWith(0);
	});
});
