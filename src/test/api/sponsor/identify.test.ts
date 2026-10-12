import handler from '@/pages/api/sponsor/identify';
import { identifyFilenames } from '@/services/contentIdentifier';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/contentIdentifier');

const mockRepository = vi.mocked(repository);
const mockIdentify = vi.mocked(identifyFilenames);

const sponsorKey = 'c'.repeat(64);
const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};
const MATRIX = 'The.Matrix.1999.1080p.BluRay.x264';

function post(body: unknown, headers: Record<string, string> = { 'x-api-key': sponsorKey }) {
	return createMockRequest({ method: 'POST', headers, body });
}

describe('/api/sponsor/identify', () => {
	beforeEach(() => {
		mockRepository.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(ACTIVE);
		mockRepository.getFilenameIdentifications = vi.fn().mockResolvedValue([]);
		mockRepository.getHashTitleIds = vi.fn().mockResolvedValue(new Map());
		mockRepository.saveFilenameIdentifications = vi.fn().mockResolvedValue(undefined);
		mockIdentify.mockResolvedValue([
			{
				kind: 'movie',
				confident: true,
				probability: 0.99,
				parsedYear: 1999,
				parsedTitle: 'The Matrix',
				matches: [{ imdbId: 'tt0133093', title: 'The Matrix', year: 1999, score: 9 }],
			},
		] as never);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("answers a sponsor's filenames like the library page", async () => {
		const res = createMockResponse();
		await handler(post({ items: [{ filename: MATRIX }] }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [{ imdbId: 'tt0133093', title: 'The Matrix', year: 1999, kind: 'movie' }],
			complete: true,
		});
	});

	it('requires a DMM API key', async () => {
		const res = createMockResponse();
		await handler(post({ items: [{ filename: MATRIX }] }, {}), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockIdentify).not.toHaveBeenCalled();
	});

	it("refuses a lapsed sponsor's key", async () => {
		mockRepository.getSponsorByDmmApiKey = vi
			.fn()
			.mockResolvedValue({ ...ACTIVE, isSponsor: false, sources: [] });
		const res = createMockResponse();
		await handler(post({ items: [{ filename: MATRIX }] }), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockIdentify).not.toHaveBeenCalled();
	});
});
