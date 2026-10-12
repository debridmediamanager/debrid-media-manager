import handler from '@/pages/api/sponsor/availability';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

const hashA = 'a'.repeat(40);
const sponsorKey = 'c'.repeat(64);
const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};
const FOUND = [{ hash: hashA, imdbId: 'tt0133093', files: [] }];

function post(body: unknown, headers: Record<string, string> = { 'x-api-key': sponsorKey }) {
	return createMockRequest({ method: 'POST', headers, body });
}

describe('/api/sponsor/availability', () => {
	beforeEach(() => {
		mockRepository.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(ACTIVE);
		mockRepository.checkAvailability = vi.fn().mockResolvedValue(FOUND);
		mockRepository.checkAvailabilityByHashes = vi.fn().mockResolvedValue(FOUND);
		mockRepository.checkAvailabilityAd = vi.fn().mockResolvedValue(FOUND);
		mockRepository.checkAvailabilityAdByHashes = vi.fn().mockResolvedValue(FOUND);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		['rd', undefined, 'checkAvailabilityByHashes'],
		['rd', 'tt0133093', 'checkAvailability'],
		['ad', undefined, 'checkAvailabilityAdByHashes'],
		['ad', 'tt0133093', 'checkAvailabilityAd'],
	] as const)('asks %s scoped to %s through %s', async (service, imdbId, method) => {
		const res = createMockResponse();
		await handler(post({ service, imdbId, hashes: [hashA.toUpperCase()] }), res);

		const args = imdbId ? [imdbId, [hashA]] : [[hashA]];
		expect(mockRepository[method]).toHaveBeenCalledWith(...args);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ available: FOUND });
	});

	it('requires a DMM API key', async () => {
		const res = createMockResponse();
		await handler(post({ service: 'rd', hashes: [hashA] }, {}), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockRepository.checkAvailabilityByHashes).not.toHaveBeenCalled();
	});

	it("refuses a lapsed sponsor's key", async () => {
		mockRepository.getSponsorByDmmApiKey = vi
			.fn()
			.mockResolvedValue({ ...ACTIVE, isSponsor: false, sources: [] });
		const res = createMockResponse();
		await handler(post({ service: 'rd', hashes: [hashA] }), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockRepository.checkAvailabilityByHashes).not.toHaveBeenCalled();
	});

	it.each([
		['no body', undefined],
		['no service', { hashes: [hashA] }],
		['an unknown service', { service: 'tb', hashes: [hashA] }],
		['a bad IMDb id', { service: 'rd', imdbId: '133093', hashes: [hashA] }],
		['no hashes', { service: 'rd' }],
		['an empty list', { service: 'rd', hashes: [] }],
		['a malformed hash', { service: 'rd', hashes: ['xyz'] }],
		['more than 100', { service: 'rd', hashes: Array.from({ length: 101 }, () => hashA) }],
	])('answers 400 for %s', async (_label, body) => {
		const res = createMockResponse();
		await handler(post(body), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockRepository.checkAvailabilityByHashes).not.toHaveBeenCalled();
	});
});
