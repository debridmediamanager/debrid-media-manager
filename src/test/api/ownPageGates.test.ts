import challenge from '@/pages/api/challenge';
import download from '@/pages/api/nzb2rd/download';
import search from '@/pages/api/nzb2rd/search';
import { fetchNzb } from '@/services/nzb2rd';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { NextApiHandler } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/nzb2rd', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/nzb2rd')>()),
	fetchNzb: vi.fn().mockRejectedValue(new Error('stop after the gate')),
	searchUsenet: vi.fn().mockResolvedValue([]),
}));

// What production saw on 2026-11-11: scripts minting challenge tokens to search
// torrents (Cenluma-Media-Intake, 22,777 in 2.5 days) and an "AIOStreams newznab
// bridge" reselling the Usenet tab's search and grabs. Behind the proxy every
// request is https, so a request without Sec-Fetch-Site is no browser page.
const SCRIPT = { 'x-forwarded-proto': 'https', 'x-real-ip': '198.51.100.7' };
const PAGE = { ...SCRIPT, 'sec-fetch-site': 'same-origin' };

const ROUTES: [string, NextApiHandler, Record<string, string>][] = [
	['/api/challenge', challenge, {}],
	['/api/nzb2rd/search', search, { imdbId: 'tt0111161' }],
	['/api/nzb2rd/download', download, { id: 'ds:abc123' }],
];

const call = async (handler: NextApiHandler, query: Record<string, string>, headers: object) => {
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'GET', query, headers: headers as any }), res as any);
	return res;
};

describe('routes only DMM pages may call', () => {
	const originalEnv = process.env;
	beforeEach(() => {
		process.env = {
			...originalEnv,
			DMM_PROBLEM_SECRET: 'test-secret',
			NZB2RD_CALLER_IPS: '203.0.113.5',
		};
		delete process.env.REDIS_URL;
	});
	afterEach(() => {
		process.env = originalEnv;
	});

	it.each(ROUTES)(
		'%s refuses a script and points it at the sponsor API',
		async (_path, handler, query) => {
			const res = await call(handler, query, SCRIPT);
			expect(res.status).toHaveBeenCalledWith(403);
			expect((res._getData() as { error: string }).error).toMatch(/sponsor API/);
		}
	);

	it.each(ROUTES)('%s refuses a cross-site page', async (_path, handler, query) => {
		const res = await call(handler, query, { ...SCRIPT, 'sec-fetch-site': 'cross-site' });
		expect(res.status).toHaveBeenCalledWith(403);
	});

	it.each(ROUTES)('%s serves a DMM page', async (_path, handler, query) => {
		const res = await call(handler, query, PAGE);
		expect(res.status).not.toHaveBeenCalledWith(403);
	});

	// nzb2rd fetches a release's other postings back, server to server.
	it('lets the nzb2rd host download without a page', async () => {
		const res = await call(
			download,
			{ id: 'ds:abc123' },
			{ ...SCRIPT, 'x-real-ip': '203.0.113.5' }
		);
		expect(res.status).not.toHaveBeenCalledWith(403);
		expect(fetchNzb).toHaveBeenCalled();
	});

	it('does not let a script claim the nzb2rd host through cf-connecting-ip', async () => {
		const res = await call(
			download,
			{ id: 'ds:abc123' },
			{ ...SCRIPT, 'cf-connecting-ip': '203.0.113.5' }
		);
		expect(res.status).toHaveBeenCalledWith(403);
	});
});
