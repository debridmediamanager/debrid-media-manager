import linkHandler from '@/pages/api/easynews/link';
import searchHandler from '@/pages/api/easynews/search';
import { EasynewsAuthError, resolveEasynewsLink, searchEasynews } from '@/services/easynews';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/easynews', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/easynews')>();
	return { ...actual, searchEasynews: vi.fn(), resolveEasynewsLink: vi.fn() };
});

const mockSearch = vi.mocked(searchEasynews);
const mockLink = vi.mocked(resolveEasynewsLink);
const login = { username: 'user', password: 'pass' };
const PATH = '682d74c4d3e935f0dee9a945a6e1a1d8010fde2f543e8.mkv/Cocaine.Bear.2023.mkv';

const run = async (handler: any, body: unknown, method = 'POST') => {
	const req = createMockRequest({ method, body });
	const res = createMockResponse();
	await handler(req, res);
	return res;
};

beforeEach(() => vi.clearAllMocks());

describe('POST /api/easynews/search', () => {
	it('searches with the caller’s own login', async () => {
		mockSearch.mockResolvedValue([{ path: PATH, title: 'Cocaine.Bear.2023', size: 1 }]);
		const res = await run(searchHandler, { ...login, title: 'Cocaine Bear', year: '2023' });

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockSearch).toHaveBeenCalledWith(login, { title: 'Cocaine Bear', year: '2023' });
		expect(res._getData()).toEqual({
			results: [{ path: PATH, title: 'Cocaine.Bear.2023', size: 1 }],
		});
	});

	it('keeps a year sent as a number', async () => {
		// /api/info/movie answers `"year": 2023` (production, tt14209916, 2026-10-25),
		// though MovieInfo types it as a string. Dropping it let "Cocaine Bear: The
		// True Story" (2023) into Cocaine Bear's results: 108 rows instead of 96.
		mockSearch.mockResolvedValue([]);
		await run(searchHandler, { ...login, title: 'Cocaine Bear', year: 2023 });
		expect(mockSearch).toHaveBeenCalledWith(login, { title: 'Cocaine Bear', year: '2023' });
	});

	it('passes a season and drops a malformed year', async () => {
		mockSearch.mockResolvedValue([]);
		await run(searchHandler, { ...login, title: 'Severance', year: 'x', seasonNum: 2 });
		expect(mockSearch).toHaveBeenCalledWith(login, { title: 'Severance', seasonNum: 2 });
	});

	it('refuses a GET, a missing login and a missing title', async () => {
		expect((await run(searchHandler, {}, 'GET')).status).toHaveBeenCalledWith(405);
		expect((await run(searchHandler, { title: 'X' })).status).toHaveBeenCalledWith(400);
		expect((await run(searchHandler, login)).status).toHaveBeenCalledWith(400);
		expect(
			(await run(searchHandler, { ...login, title: 'X', seasonNum: -1 })).status
		).toHaveBeenCalledWith(400);
		expect(mockSearch).not.toHaveBeenCalled();
	});

	it('says 401 when Easynews refuses the login and 502 when it is down', async () => {
		mockSearch.mockRejectedValueOnce(new EasynewsAuthError());
		expect((await run(searchHandler, { ...login, title: 'X' })).status).toHaveBeenCalledWith(
			401
		);
		mockSearch.mockRejectedValueOnce(new Error('HTTP 503'));
		expect((await run(searchHandler, { ...login, title: 'X' })).status).toHaveBeenCalledWith(
			502
		);
	});
});

describe('POST /api/easynews/link', () => {
	it('hands back the signed link', async () => {
		mockLink.mockResolvedValue('https://ams-dl-01.easynews.com/dl/T/x.mkv');
		const res = await run(linkHandler, { ...login, path: PATH });
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockLink).toHaveBeenCalledWith(login, PATH);
		expect(res._getData()).toEqual({ url: 'https://ams-dl-01.easynews.com/dl/T/x.mkv' });
	});

	it('refuses a path that is not a result', async () => {
		const res = await run(linkHandler, { ...login, path: '../2.0/api/dl-nzb' });
		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockLink).not.toHaveBeenCalled();
	});

	it('says 401 when Easynews refuses the login', async () => {
		mockLink.mockRejectedValue(new EasynewsAuthError());
		expect((await run(linkHandler, { ...login, path: PATH })).status).toHaveBeenCalledWith(401);
	});
});
