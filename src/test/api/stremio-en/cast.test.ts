import movieHandler from '@/pages/api/stremio-en/cast/movie/[imdbid]';
import seriesHandler from '@/pages/api/stremio-en/cast/series/[imdbid]';
import { EasynewsAuthError, EasynewsGoneError, resolveEasynewsLink } from '@/services/easynews';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { easynewsCastUserId } from '@/utils/easynewsCastApiHelpers';
import { easynewsCastKey } from '@/utils/easynewsCastKey';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/easynews', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/easynews')>()),
	resolveEasynewsLink: vi.fn(),
}));
vi.mock('@/services/repository');

const mockResolve = vi.mocked(resolveEasynewsLink);
const mockRepository = vi.mocked(repository);
const LOGIN = { username: 'Alice', password: 'pw' };
const KEY = easynewsCastKey(LOGIN);
// From the recorded Severance S02 search (2026-10-25).
const HASH = 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2';
const EPISODE = `${HASH}.mkv/severance.2022.s02e05.multi.2160p.web.h265-higgsboson.mkv`;
const FILM = `${HASH}.mkv/Cocaine.Bear.2023.2160p.WEB-DL.mkv`;
const originalSalt = process.env.DMMCAST_SALT;

const request = (imdbid: string, path: string, size: unknown = 7733466971, key = KEY) =>
	createMockRequest({
		method: 'POST',
		query: { imdbid },
		headers: { authorization: `Bearer ${key}` },
		body: { path, size },
	});

describe('/api/stremio-en/cast', () => {
	beforeEach(() => {
		process.env.DMMCAST_SALT = 'test-salt';
		vi.clearAllMocks();
		mockResolve.mockResolvedValue('https://members-de.easynews.com/signed');
		mockRepository.saveEasynewsCast = vi.fn().mockResolvedValue(undefined);
	});
	afterAll(() => {
		process.env.DMMCAST_SALT = originalSalt;
	});

	it('files an episode under imdbid:season:episode with its path and size in MB', async () => {
		const res = createMockResponse();
		await seriesHandler(request('tt11280740', EPISODE), res);

		expect(res._getStatusCode()).toBe(200);
		expect(mockResolve).toHaveBeenCalledWith(LOGIN, EPISODE);
		expect(mockRepository.saveEasynewsCast).toHaveBeenCalledWith(
			'tt11280740:2:5',
			easynewsCastUserId('Alice'),
			HASH,
			'severance.2022.s02e05.multi.2160p.web.h265-higgsboson.mkv',
			7375,
			EPISODE
		);
		expect(res._getData()).toMatchObject({ key: 'tt11280740:2:5' });
	});

	it('files a film under its IMDb id', async () => {
		const res = createMockResponse();
		await movieHandler(request('tt14141770', FILM, 1024 * 1024 * 1024), res);
		expect(res._getStatusCode()).toBe(200);
		expect(vi.mocked(mockRepository.saveEasynewsCast).mock.calls[0][0]).toBe('tt14141770');
		expect(vi.mocked(mockRepository.saveEasynewsCast).mock.calls[0][4]).toBe(1024);
	});

	it('refuses an episode file with no episode in its name, before asking Easynews', async () => {
		const res = createMockResponse();
		await seriesHandler(request('tt11280740', FILM), res);
		expect(res._getStatusCode()).toBe(422);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it('keeps nothing when Easynews refuses the login', async () => {
		mockResolve.mockRejectedValue(new EasynewsAuthError());
		const res = createMockResponse();
		await movieHandler(request('tt14141770', FILM), res);
		expect(res._getStatusCode()).toBe(401);
		expect(mockRepository.saveEasynewsCast).not.toHaveBeenCalled();
	});

	// Easynews still lists files it can no longer serve (2026-11-07).
	it('keeps nothing for a listed file Easynews can no longer serve', async () => {
		mockResolve.mockRejectedValue(new EasynewsGoneError());
		const res = createMockResponse();
		await movieHandler(request('tt14141770', FILM), res);
		expect(res._getStatusCode()).toBe(410);
		expect(mockRepository.saveEasynewsCast).not.toHaveBeenCalled();
	});

	it.each([
		['a missing key', request('tt14141770', FILM, 1, '')],
		['a malformed key', request('tt14141770', FILM, 1, '%%%')],
		['a path outside the download folder', request('tt14141770', '../../etc/passwd')],
		['a bad IMDb id', request('nope', FILM)],
		['a bad size', request('tt14141770', FILM, 'big')],
	])('answers 400 for %s', async (_, req) => {
		const res = createMockResponse();
		await movieHandler(req, res);
		expect(res._getStatusCode()).toBe(400);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it('takes the key from the header only, never the URL', async () => {
		const res = createMockResponse();
		await movieHandler(
			createMockRequest({
				method: 'POST',
				query: { imdbid: 'tt14141770', apiKey: KEY },
				body: { path: FILM, size: 1 },
			}),
			res
		);
		expect(res._getStatusCode()).toBe(400);
	});
});
