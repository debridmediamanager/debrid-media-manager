import handler from '@/pages/api/easynews/send';
import { fetchEasynewsNzb } from '@/services/easynews';
import { _resetTokenSecretForTest } from '@/services/newznab/opaqueId';
import { isStoreConfigured, putStoredNzb } from '@/services/newznab/store';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { setBlocklistForTests } from '@/services/takedown/blocklist';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { activeSponsor } from '@/test/utils/sponsor';
import { SPONSOR_HEADER } from '@/utils/requireSponsor';
import { normalizeReleaseName } from '@/utils/takedownParse';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/easynews', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/easynews')>()),
	fetchEasynewsNzb: vi.fn(),
}));
vi.mock('@/services/newznab/store', () => ({
	putStoredNzb: vi.fn(),
	isStoreConfigured: vi.fn(),
}));
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

// The head of a real dl-nzb answer for this file, captured 2026-11-07.
const NZB = readFileSync(
	path.resolve(__dirname, '../../fixtures/easynews/dl-nzb-oppenheimer-2023-head-2026-11-07.nzb'),
	'latin1'
);
const HASH = '9e26b9f3327b7175604928437b0766cf04ea695054e26';
const FILM = 'Oppenheimer 2023 2160p BluRay Remux DV HDR10+ DTS-HD MA 5.1 HEVC-tarunk9c.mkv';
const EPISODE = 'severance.2022.s02e05.multi.1080p.web.h264-higgsboson.mkv';
const login = { username: 'user', password: 'pass' };
const film = {
	...login,
	path: `${HASH}.mkv/${FILM}`,
	sig: 'S'.repeat(143),
	size: 91459209764,
	imdbId: 'tt15398776',
	kind: 'movie',
	title: 'Oppenheimer',
};
const ROW = {
	id: '0b7c2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b',
	imdbId: 'tt15398776',
	kind: 'movie' as const,
	title: 'Oppenheimer',
	seasons: null,
	createdAt: new Date('2026-11-07T10:00:00Z'),
	fulfilledAt: null,
	fulfilled: null,
	lastPolledAt: null,
	pins: [{ id: HASH, release: FILM, size: 91459209764, at: '2026-11-07T10:00:00.000Z' }],
};

describe('POST /api/easynews/send', () => {
	let token: string;
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
		process.env.NEWZNAB_TOKEN_SECRET = 'a'.repeat(64);
		_resetTokenSecretForTest();
		token = activeSponsor();
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
		vi.mocked(isStoreConfigured).mockReturnValue(true);
		vi.mocked(putStoredNzb).mockResolvedValue(true as never);
		vi.mocked(fetchEasynewsNzb).mockResolvedValue(NZB);
		repository.pinWanted = vi.fn().mockResolvedValue(ROW);
		repository.addEasynewsNzb = vi.fn().mockResolvedValue(undefined);
	});
	afterEach(() => {
		vi.clearAllMocks();
		setBlocklistForTests([]);
		delete process.env.DMM_SPONSOR_SECRET;
		delete process.env.NEWZNAB_TOKEN_SECRET;
		_resetTokenSecretForTest();
	});

	const run = async (body: unknown) => {
		const req = createMockRequest({
			method: 'POST',
			headers: { [SPONSOR_HEADER]: token },
			body,
		});
		const res = createMockResponse();
		await handler(req, res);
		return res;
	};

	it('stores the cleaned NZB under en and its hash, then pins the film', async () => {
		const res = await run(film);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(fetchEasynewsNzb).toHaveBeenCalledWith(login, film.path, film.sig);
		const [prefix, nativeId, xml] = vi.mocked(putStoredNzb).mock.calls[0];
		expect([prefix, nativeId]).toEqual(['en', HASH]);
		// Cleaned on the way in: the posters are gone, the segments stay.
		expect(xml).not.toContain('poster=');
		expect(xml).toContain('01d1ff232a0648ee96640f13d937b273@YWx0aHVi');
		expect(repository.pinWanted).toHaveBeenCalledWith(
			'ZP1M',
			{ imdbId: 'tt15398776', kind: 'movie', title: 'Oppenheimer' },
			{ id: HASH, release: FILM, size: 91459209764, at: expect.any(String) }
		);
		expect(vi.mocked(putStoredNzb).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(repository.pinWanted).mock.invocationCallOrder[0]
		);
		// Listed with the film's Usenet results, under the id fetchNzb reads from the store.
		expect(repository.addEasynewsNzb).toHaveBeenCalledWith('tt15398776', undefined, {
			id: `en:${HASH}`,
			title: FILM.replace(/\.mkv$/, ''),
			size: 91459209764,
		});
		expect(vi.mocked(putStoredNzb).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(repository.addEasynewsNzb).mock.invocationCallOrder[0]
		);
		expect(vi.mocked(res.json).mock.calls[0][0].item).toMatchObject({
			imdbId: 'tt15398776',
			pins: [{ id: HASH, release: FILM }],
			createdAt: '2026-11-07T10:00:00.000Z',
		});
	});

	it('pins a show episode by the SxxEyy in its name', async () => {
		await run({
			...film,
			path: `${HASH}.mkv/${EPISODE}`,
			imdbId: 'tt11280740',
			kind: 'show',
			title: 'Severance',
		});
		expect(vi.mocked(repository.pinWanted).mock.calls[0][2]).toMatchObject({
			release: EPISODE,
			season: 2,
			episode: 5,
		});
		// Under its season, as the show page's Usenet table asks for it.
		expect(repository.addEasynewsNzb).toHaveBeenCalledWith('tt11280740', 2, {
			id: `en:${HASH}`,
			title: EPISODE.replace(/\.mkv$/, ''),
			size: 91459209764,
		});
	});

	it('refuses a show file that names no episode, before fetching anything', async () => {
		const res = await run({ ...film, kind: 'show' });
		expect(res.status).toHaveBeenCalledWith(400);
		expect(fetchEasynewsNzb).not.toHaveBeenCalled();
	});

	it('answers 503 when there is no store to keep the NZB in, or the write fails', async () => {
		vi.mocked(isStoreConfigured).mockReturnValue(false);
		expect((await run(film)).status).toHaveBeenCalledWith(503);
		expect(fetchEasynewsNzb).not.toHaveBeenCalled();

		vi.mocked(isStoreConfigured).mockReturnValue(true);
		vi.mocked(putStoredNzb).mockRejectedValue(new Error('B2 503'));
		expect((await run(film)).status).toHaveBeenCalledWith(503);
		expect(repository.pinWanted).not.toHaveBeenCalled();
		// Never listed without its NZB: a row nobody can fetch would only fail on click.
		expect(repository.addEasynewsNzb).not.toHaveBeenCalled();
	});

	it('refuses a release on the takedown list', async () => {
		setBlocklistForTests([], [normalizeReleaseName(FILM.replace(/\.mkv$/, ''))]);
		const res = await run(film);
		expect(res.status).toHaveBeenCalledWith(404);
		expect(putStoredNzb).not.toHaveBeenCalled();
		expect(repository.pinWanted).not.toHaveBeenCalled();
	});

	it('refuses a bad body, and passes on what Easynews and the list said', async () => {
		expect((await run({ ...film, sig: '' })).status).toHaveBeenCalledWith(400);
		expect((await run({ ...film, imdbId: '15398776' })).status).toHaveBeenCalledWith(400);
		expect((await run({ ...film, path: '../x' })).status).toHaveBeenCalledWith(400);
		expect((await run({ ...film, password: undefined })).status).toHaveBeenCalledWith(400);

		const { EasynewsAuthError, EasynewsNzbError } = await import('@/services/easynews');
		vi.mocked(fetchEasynewsNzb).mockRejectedValueOnce(new EasynewsAuthError());
		expect((await run(film)).status).toHaveBeenCalledWith(401);
		vi.mocked(fetchEasynewsNzb).mockRejectedValueOnce(
			new EasynewsNzbError('Easynews did not hand out this NZB; search again')
		);
		const empty = await run(film);
		expect(empty.status).toHaveBeenCalledWith(422);
		expect(vi.mocked(empty.json).mock.calls[0][0].error).toContain('search again');

		repository.pinWanted = vi.fn().mockResolvedValue(null);
		expect((await run(film)).status).toHaveBeenCalledWith(409);
	});
});
