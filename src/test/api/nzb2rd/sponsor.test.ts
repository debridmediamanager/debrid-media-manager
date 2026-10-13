import handler from '@/pages/api/nzb2rd/sponsor';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const lookup = (isSponsor: boolean) => ({
	isSponsor,
	sources: isSponsor ? ['patreon' as const] : [],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
});

const call = async (
	query: Record<string, string>,
	authorization: string | null = 'Bearer s3cret',
	method = 'GET'
) => {
	const res = createMockResponse();
	await handler(
		createMockRequest({ method, query, headers: authorization ? { authorization } : {} }),
		res
	);
	return res;
};

// nzb2rd asks this as a sponsor's queued job is about to start, so the queue
// priority and the sponsor allowance end with the sponsorship instead of lasting
// as long as the job waits.
describe('/api/nzb2rd/sponsor', () => {
	const original = process.env.METADATA_API_SECRET;
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.METADATA_API_SECRET = 's3cret';
	});
	afterEach(() => {
		if (original === undefined) delete process.env.METADATA_API_SECRET;
		else process.env.METADATA_API_SECRET = original;
	});

	it('answers active for a sponsorship that is still paying', async () => {
		vi.mocked(repository.getSponsorByShortId).mockResolvedValue(lookup(true));
		const res = await call({ id: 'ZP1M' });
		expect(repository.getSponsorByShortId).toHaveBeenCalledWith('ZP1M');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ active: true });
	});

	it('answers inactive once the sponsorship has lapsed', async () => {
		vi.mocked(repository.getSponsorByShortId).mockResolvedValue(lookup(false));
		const res = await call({ id: 'ZP1M' });
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ active: false });
	});

	it('answers inactive for an id no sponsor holds', async () => {
		vi.mocked(repository.getSponsorByShortId).mockResolvedValue(null);
		const res = await call({ id: 'NONE' });
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ active: false });
	});

	it('refuses a caller without the secret, before any lookup', async () => {
		expect((await call({ id: 'ZP1M' }, null))._getStatusCode()).toBe(401);
		expect((await call({ id: 'ZP1M' }, 'Bearer wrong'))._getStatusCode()).toBe(401);
		delete process.env.METADATA_API_SECRET;
		expect((await call({ id: 'ZP1M' }))._getStatusCode()).toBe(401);
		expect(repository.getSponsorByShortId).not.toHaveBeenCalled();
	});

	it('rejects an id that is not a Sponsorship ID', async () => {
		for (const id of ['', 'ZP 1M', '../x', 'a'.repeat(33)]) {
			expect((await call({ id }))._getStatusCode()).toBe(400);
		}
		expect((await call({}))._getStatusCode()).toBe(400);
		expect(repository.getSponsorByShortId).not.toHaveBeenCalled();
	});

	// nzb2rd keeps the tier on anything but a definite answer, so a database
	// blip here must not read as "lapsed".
	it('answers 503 rather than a verdict when the lookup fails', async () => {
		vi.mocked(repository.getSponsorByShortId).mockRejectedValue(new Error('db down'));
		const res = await call({ id: 'ZP1M' });
		expect(res._getStatusCode()).toBe(503);
		expect(res._getData()).not.toHaveProperty('active');
	});

	it('answers GET only', async () => {
		expect((await call({ id: 'ZP1M' }, 'Bearer s3cret', 'POST'))._getStatusCode()).toBe(405);
	});
});
