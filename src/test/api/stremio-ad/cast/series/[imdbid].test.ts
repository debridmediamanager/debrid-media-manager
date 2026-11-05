import handler from '@/pages/api/stremio-ad/cast/series/[imdbid]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateUserId, mockSaveCast } = vi.hoisted(() => ({
	mockGenerateUserId: vi.fn(),
	mockSaveCast: vi.fn(),
}));

vi.mock('@/utils/allDebridCastApiHelpers', () => ({
	generateAllDebridUserId: mockGenerateUserId,
}));

vi.mock('@/services/repository', () => ({
	repository: { saveAllDebridCast: mockSaveCast },
}));

vi.mock('@/services/allDebridCastSelection', () => ({
	getVerifiedAllDebridCastFiles: vi.fn(async () => [
		{ path: 'Show.S01E01.mkv', link: baseBody.files[0].link, size: 500 * 1024 * 1024 },
		{},
		{ path: 'Show.S01E03.mkv', link: baseBody.files[1].link, size: 500 * 1024 * 1024 },
	]),
}));

const baseBody = {
	apiKey: 'ad-key',
	hash: 'a'.repeat(40),
	magnetId: 99,
	files: [
		{
			fileIndex: 0,
			link: `https://alldebrid.com/f/${'A'.repeat(43)}`,
			filename: 'Show.S01E01.mkv',
			fileSize: 500,
			season: 1,
			episode: 1,
		},
		{
			fileIndex: 2,
			link: `https://alldebrid.com/f/${'B'.repeat(43)}`,
			filename: 'Show.S01E03.mkv',
			fileSize: 500,
			season: 1,
			episode: 3,
		},
	],
};

describe('/api/stremio-ad/cast/series/[imdbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateUserId.mockResolvedValue('user-1');
		mockSaveCast.mockResolvedValue(undefined);
	});

	it('rejects non-POST', async () => {
		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt1' } });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('returns 400 for missing fields or empty files array', async () => {
		const res1 = createMockResponse();
		await handler(
			createMockRequest({ method: 'POST', query: { imdbid: 'tt1' }, body: {} }),
			res1
		);
		expect(res1.status).toHaveBeenCalledWith(400);

		const res2 = createMockResponse();
		await handler(
			createMockRequest({
				method: 'POST',
				query: { imdbid: 'tt1' },
				body: { ...baseBody, files: [] },
			}),
			res2
		);
		expect(res2.status).toHaveBeenCalledWith(400);
	});

	it('saves each file with episodeImdbId suffix from season/episode', async () => {
		const req = createMockRequest({ method: 'POST', query: { imdbid: 'tt1' }, body: baseBody });
		const res = createMockResponse();
		await handler(req, res);

		expect(mockSaveCast).toHaveBeenCalledTimes(2);
		expect(mockSaveCast).toHaveBeenNthCalledWith(
			1,
			'tt1:1:1',
			'user-1',
			baseBody.hash,
			'Show.S01E01.mkv',
			baseBody.files[0].link,
			500,
			99,
			0
		);
		expect(mockSaveCast).toHaveBeenNthCalledWith(
			2,
			'tt1:1:3',
			'user-1',
			baseBody.hash,
			'Show.S01E03.mkv',
			baseBody.files[1].link,
			500,
			99,
			2
		);
		expect(res.status).toHaveBeenCalledWith(200);
		const payload = (res.json as Mock).mock.calls[0][0];
		expect(payload.status).toBe('success');
		expect(payload.errorEpisodes).toEqual([]);
	});

	it('returns partial status and errorEpisodes when a save fails', async () => {
		mockSaveCast.mockRejectedValueOnce(new Error('db fail')).mockResolvedValueOnce(undefined);
		const req = createMockRequest({ method: 'POST', query: { imdbid: 'tt1' }, body: baseBody });
		const res = createMockResponse();
		await handler(req, res);

		const payload = (res.json as Mock).mock.calls[0][0];
		expect(payload.status).toBe('partial');
		expect(payload.errorEpisodes).toEqual(['Show.S01E01.mkv']);
	});

	it('skips malformed file entries and records them as errors', async () => {
		const body = {
			...baseBody,
			files: [
				{ ...baseBody.files[0] },
				{ fileIndex: 'not-a-number', link: 'y', filename: 'bad.mkv', fileSize: 2 },
			],
		};
		const req = createMockRequest({ method: 'POST', query: { imdbid: 'tt1' }, body });
		const res = createMockResponse();
		await handler(req, res);

		expect(mockSaveCast).toHaveBeenCalledTimes(1); // only the valid one
		const payload = (res.json as Mock).mock.calls[0][0];
		expect(payload.status).toBe('partial');
		expect(payload.errorEpisodes.length).toBe(1);
	});

	it('falls back to bare imdbid when season/episode missing', async () => {
		const body = {
			...baseBody,
			files: [
				{ fileIndex: 0, link: baseBody.files[0].link, filename: 'Movie.mkv', fileSize: 1 },
			],
		};
		const req = createMockRequest({ method: 'POST', query: { imdbid: 'tt1' }, body });
		const res = createMockResponse();
		await handler(req, res);
		expect(mockSaveCast).toHaveBeenCalledWith(
			'tt1',
			'user-1',
			baseBody.hash,
			'Show.S01E01.mkv',
			baseBody.files[0].link,
			500,
			99,
			0
		);
	});
});
