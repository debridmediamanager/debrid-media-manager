import submit from '@/pages/api/availability/dl';
import check from '@/pages/api/availability/dl/check';
import remove from '@/pages/api/availability/dl/remove';
import { repository } from '@/services/repository';
import dlMovie from '@/test/fixtures/libraryAvailability/dl_movie.json';
import dlTv from '@/test/fixtures/libraryAvailability/dl_tv.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/problemToken');

const mockRepository = vi.mocked(repository);
const token = { dmmProblemKey: 'key-1-1234567890', solution: 'solution-hash' };

// real seedbox rows from the Debrid-Link main account (2026-11-05), download URLs redacted
const body = (torrent: typeof dlMovie, imdbId: string, overrides: object = {}) => ({
	...token,
	hash: torrent.hashString,
	imdbId,
	filename: torrent.name,
	files: torrent.files.map(({ name, size, downloadPercent }) => ({
		name,
		size,
		downloadPercent,
	})),
	...overrides,
});

const call = async (handler: any, req: object) => {
	const res = createMockResponse();
	await handler(
		createMockRequest({ method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, ...req }),
		res
	);
	return res;
};

describe('/api/availability/dl', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(validateProblemToken).mockReturnValue(true);
		mockRepository.upsertAvailabilityDl = vi.fn().mockResolvedValue(undefined);
		mockRepository.checkAvailabilityDl = vi.fn().mockResolvedValue([]);
		mockRepository.removeAvailabilityDl = vi.fn().mockResolvedValue(undefined);
	});

	it('records a whole season pack by path and size only', async () => {
		const res = await call(submit, { body: body(dlTv, 'tt0108778') });
		expect(res.status).toHaveBeenCalledWith(200);
		const saved = vi.mocked(mockRepository.upsertAvailabilityDl).mock.calls[0][0];
		expect(saved).toMatchObject({ hash: dlTv.hashString, imdbId: 'tt0108778' });
		expect(saved.files).toHaveLength(24);
		expect(saved.files[0]).toEqual({ path: dlTv.files[0].name, bytes: dlTv.files[0].size });
	});

	it('never stores a download URL, even when one is sent', async () => {
		const withUrls = body(dlMovie, 'tt1375666', { files: dlMovie.files });
		await call(submit, { body: withUrls });
		const saved = vi.mocked(mockRepository.upsertAvailabilityDl).mock.calls[0][0];
		expect(JSON.stringify(saved)).not.toContain('downloadUrl');
		expect(JSON.stringify(saved)).not.toContain('debrid.link');
	});

	it('refuses a file short of 100%, a release that is not video, and a bad token', async () => {
		const partial = body(dlMovie, 'tt1375666');
		partial.files[0].downloadPercent = 97;
		expect((await call(submit, { body: partial })).status).toHaveBeenCalledWith(400);

		const audio = body(dlMovie, 'tt1375666');
		audio.files[0].name = 'Album/01 Track.flac';
		expect((await call(submit, { body: audio })).status).toHaveBeenCalledWith(400);

		expect(
			(await call(submit, { body: body(dlMovie, 'not-imdb') })).status
		).toHaveBeenCalledWith(400);

		vi.mocked(validateProblemToken).mockReturnValue(false);
		expect(
			(await call(submit, { body: body(dlMovie, 'tt1375666') })).status
		).toHaveBeenCalledWith(403);
		expect(mockRepository.upsertAvailabilityDl).not.toHaveBeenCalled();
	});

	it('checks under an IMDb id, or by hash alone without one', async () => {
		await call(check, {
			body: { ...token, imdbId: 'tt1375666', hashes: [dlMovie.hashString] },
		});
		expect(mockRepository.checkAvailabilityDl).toHaveBeenLastCalledWith(
			[dlMovie.hashString],
			'tt1375666'
		);
		await call(check, { body: { ...token, hashes: [dlMovie.hashString] } });
		expect(mockRepository.checkAvailabilityDl).toHaveBeenLastCalledWith(
			[dlMovie.hashString],
			undefined
		);
		const tooMany = Array.from({ length: 101 }, () => dlMovie.hashString);
		expect(
			(await call(check, { body: { ...token, hashes: tooMany } })).status
		).toHaveBeenCalledWith(400);
	});

	it('forgets a release an add found uncached', async () => {
		const res = await call(remove, {
			body: { ...token, hash: dlMovie.hashString, reason: 'add did not finish' },
		});
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.removeAvailabilityDl).toHaveBeenCalledWith(dlMovie.hashString);
	});
});
