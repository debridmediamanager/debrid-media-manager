import handler from '@/pages/api/metadata/[imdbId]';
import { getMetadata } from '@/services/metadata';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/metadata', () => ({ getMetadata: vi.fn() }));

const call = async (query: Record<string, string>, authorization?: string, method = 'GET') => {
	const req = createMockRequest({
		method,
		query,
		headers: authorization ? { authorization } : {},
	});
	const res = createMockResponse();
	await handler(req, res);
	return res;
};

describe('/api/metadata/[imdbId]', () => {
	const original = process.env.METADATA_API_SECRET;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.METADATA_API_SECRET = 's3cret';
	});

	afterEach(() => {
		if (original === undefined) delete process.env.METADATA_API_SECRET;
		else process.env.METADATA_API_SECRET = original;
	});

	it('refuses a request without the secret, with a wrong one, and when none is configured', async () => {
		expect((await call({ imdbId: 'tt0245429' })).status).toHaveBeenCalledWith(401);
		expect((await call({ imdbId: 'tt0245429' }, 'Bearer nope')).status).toHaveBeenCalledWith(
			401
		);
		delete process.env.METADATA_API_SECRET;
		expect((await call({ imdbId: 'tt0245429' }, 'Bearer ')).status).toHaveBeenCalledWith(401);
		expect(getMetadata).not.toHaveBeenCalled();
	});

	it('rejects a malformed id and a non-GET', async () => {
		expect((await call({ imdbId: 'spirited' }, 'Bearer s3cret')).status).toHaveBeenCalledWith(
			400
		);
		expect(
			(await call({ imdbId: 'tt0245429' }, 'Bearer s3cret', 'POST')).status
		).toHaveBeenCalledWith(405);
	});

	it('answers the canonical record', async () => {
		vi.mocked(getMetadata).mockResolvedValue({
			imdbId: 'tt0245429',
			type: 'movie',
			year: 2001,
		} as any);
		const res = await call({ imdbId: 'tt0245429' }, 'Bearer s3cret');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ year: 2001 }));
	});

	it('answers 404 for an id no provider knows, and 500 when the lookup throws', async () => {
		vi.mocked(getMetadata).mockResolvedValueOnce(null);
		expect((await call({ imdbId: 'tt9999999' }, 'Bearer s3cret')).status).toHaveBeenCalledWith(
			404
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(getMetadata).mockRejectedValueOnce(new Error('boom'));
		expect((await call({ imdbId: 'tt9999999' }, 'Bearer s3cret')).status).toHaveBeenCalledWith(
			500
		);
	});
});
