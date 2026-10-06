import handler from '@/pages/api/torrents/identify';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

const hashA = 'a'.repeat(40);
const hashB = 'B'.repeat(40);
const sponsorKey = 'c'.repeat(64);
const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};

function post(body: unknown, headers: Record<string, string> = { 'x-api-key': sponsorKey }) {
	return createMockRequest({ method: 'POST', headers, body });
}

describe('/api/torrents/identify', () => {
	beforeEach(() => {
		mockRepository.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(ACTIVE);
		mockRepository.identifyLibraryHashes = vi
			.fn()
			.mockResolvedValue(
				new Map([[hashA, { imdbId: 'tt0133093', title: 'The Matrix', year: 1999 }]])
			);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('answers the identities DMM holds, keyed by lower-case hash', async () => {
		const res = createMockResponse();
		await handler(post({ hashes: [hashA, hashB] }), res);

		expect(mockRepository.identifyLibraryHashes).toHaveBeenCalledWith([hashA, hashB]);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			identities: { [hashA]: { imdbId: 'tt0133093', title: 'The Matrix', year: 1999 } },
		});
	});

	it('requires a DMM API key', async () => {
		const res = createMockResponse();
		await handler(post({ hashes: [hashA] }, {}), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockRepository.identifyLibraryHashes).not.toHaveBeenCalled();
	});

	it("refuses a lapsed sponsor's key", async () => {
		mockRepository.getSponsorByDmmApiKey = vi
			.fn()
			.mockResolvedValue({ ...ACTIVE, isSponsor: false, sources: [] });
		const res = createMockResponse();
		await handler(post({ hashes: [hashA] }), res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockRepository.identifyLibraryHashes).not.toHaveBeenCalled();
	});

	it.each([
		['no body', undefined],
		['no hashes', {}],
		['an empty list', { hashes: [] }],
		['a malformed hash', { hashes: ['xyz'] }],
		['more than 500', { hashes: Array.from({ length: 501 }, () => hashA) }],
	])('answers 400 for %s', async (_label, body) => {
		const res = createMockResponse();
		await handler(post(body), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockRepository.identifyLibraryHashes).not.toHaveBeenCalled();
	});

	it('answers 405 to anything but POST', async () => {
		const res = createMockResponse();
		await handler(
			createMockRequest({ method: 'GET', headers: { 'x-api-key': sponsorKey } }),
			res
		);

		expect(res.status).toHaveBeenCalledWith(405);
	});
});
