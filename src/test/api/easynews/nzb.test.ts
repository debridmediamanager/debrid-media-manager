import handler from '@/pages/api/easynews/nzb';
import { EasynewsAuthError, EasynewsNzbError, fetchEasynewsNzb } from '@/services/easynews';
import { isStoreConfigured, putStoredNzb } from '@/services/newznab/store';
import { repository } from '@/services/repository';
import { setBlocklistForTests } from '@/services/takedown/blocklist';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
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

// The head of a real dl-nzb answer for this file, captured 2026-11-07.
const NZB = readFileSync(
	path.resolve(__dirname, '../../fixtures/easynews/dl-nzb-oppenheimer-2023-head-2026-11-07.nzb'),
	'latin1'
);
const HASH = '9e26b9f3327b7175604928437b0766cf04ea695054e26';
const FILM = 'Oppenheimer 2023 2160p BluRay Remux DV HDR10+ DTS-HD MA 5.1 HEVC-tarunk9c.mkv';
const login = { username: 'user', password: 'pass' };
const row = {
	...login,
	path: `${HASH}.mkv/${FILM}`,
	sig: 'S'.repeat(143),
	size: 91459209764,
	imdbId: 'tt15398776',
	kind: 'movie',
};

const run = async (body: unknown, method = 'POST') => {
	const req = createMockRequest({ method, body });
	const res = createMockResponse();
	await handler(req, res);
	return res;
};
const header = (res: ReturnType<typeof createMockResponse>, name: string) =>
	vi.mocked(res.setHeader).mock.calls.find(([key]) => key === name)?.[1];

describe('POST /api/easynews/nzb', () => {
	beforeEach(() => {
		vi.mocked(isStoreConfigured).mockReturnValue(true);
		vi.mocked(putStoredNzb).mockResolvedValue(true as never);
		vi.mocked(fetchEasynewsNzb).mockResolvedValue(NZB);
		repository.addEasynewsNzb = vi.fn().mockResolvedValue(undefined);
	});
	afterEach(() => {
		vi.clearAllMocks();
		setBlocklistForTests([]);
	});

	it("hands back the row's NZB, cleaned, as a file named after the release", async () => {
		const res = await run(row);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(fetchEasynewsNzb).toHaveBeenCalledWith(login, row.path, row.sig);
		const xml = vi.mocked(res.send).mock.calls[0][0] as string;
		expect(xml).not.toContain('poster=');
		expect(xml).toContain('01d1ff232a0648ee96640f13d937b273@YWx0aHVi');
		expect(header(res, 'Content-Type')).toBe('application/x-nzb; charset=utf-8');
		expect(header(res, 'Content-Disposition')).toContain(
			`filename="${FILM.replace(/\.mkv$/, '.nzb')}"`
		);
		expect(header(res, 'Cache-Control')).toBe('private, no-store');
		// Kept for the film's Usenet table, as Send to zurg keeps it.
		await vi.waitFor(() =>
			expect(repository.addEasynewsNzb).toHaveBeenCalledWith('tt15398776', undefined, {
				id: `en:${HASH}`,
				title: FILM.replace(/\.mkv$/, ''),
				size: 91459209764,
			})
		);
		expect(vi.mocked(putStoredNzb).mock.calls[0].slice(0, 2)).toEqual(['en', HASH]);
	});

	it('still hands the NZB over when it cannot be kept', async () => {
		vi.mocked(isStoreConfigured).mockReturnValue(false);
		const res = await run({ ...row, imdbId: undefined });
		expect(res.status).toHaveBeenCalledWith(200);
		expect(putStoredNzb).not.toHaveBeenCalled();

		vi.mocked(isStoreConfigured).mockReturnValue(true);
		vi.mocked(putStoredNzb).mockRejectedValue(new Error('B2 503'));
		expect((await run(row)).status).toHaveBeenCalledWith(200);
	});

	it('refuses a release on the takedown list', async () => {
		setBlocklistForTests([], [normalizeReleaseName(FILM.replace(/\.mkv$/, ''))]);
		const res = await run(row);
		expect(res.status).toHaveBeenCalledWith(451);
		expect(res.send).not.toHaveBeenCalled();
		expect(putStoredNzb).not.toHaveBeenCalled();
	});

	it('refuses a bad request before asking Easynews', async () => {
		expect((await run(row, 'GET')).status).toHaveBeenCalledWith(405);
		expect((await run({ ...row, sig: undefined })).status).toHaveBeenCalledWith(400);
		expect((await run({ ...row, path: '../2.0/api/dl-nzb' })).status).toHaveBeenCalledWith(400);
		expect((await run({ ...row, password: undefined })).status).toHaveBeenCalledWith(400);
		expect(fetchEasynewsNzb).not.toHaveBeenCalled();
	});

	it('passes on what Easynews said', async () => {
		vi.mocked(fetchEasynewsNzb).mockRejectedValueOnce(new EasynewsAuthError());
		expect((await run(row)).status).toHaveBeenCalledWith(401);
		vi.mocked(fetchEasynewsNzb).mockRejectedValueOnce(
			new EasynewsNzbError('Easynews did not hand out this NZB; search again')
		);
		const empty = await run(row);
		expect(empty.status).toHaveBeenCalledWith(422);
		expect(vi.mocked(empty.json).mock.calls[0][0].error).toContain('search again');
		vi.mocked(fetchEasynewsNzb).mockRejectedValueOnce(new Error('HTTP 503'));
		expect((await run(row)).status).toHaveBeenCalledWith(502);
	});
});
