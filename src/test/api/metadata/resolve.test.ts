import handler from '@/pages/api/metadata/resolve';
import { resolveTitle } from '@/services/metadata/resolve';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/metadata/resolve', () => ({ resolveTitle: vi.fn() }));

const call = async (query: Record<string, string>, authorization = 'Bearer s3cret') => {
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'GET', query, headers: { authorization } }), res);
	return res;
};

describe('/api/metadata/resolve', () => {
	const original = process.env.METADATA_API_SECRET;
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.METADATA_API_SECRET = 's3cret';
	});
	afterEach(() => {
		if (original === undefined) delete process.env.METADATA_API_SECRET;
		else process.env.METADATA_API_SECRET = original;
	});

	it('refuses a caller without the secret', async () => {
		expect((await call({ title: 'Dune' }, 'Bearer wrong')).status).toHaveBeenCalledWith(401);
		expect(resolveTitle).not.toHaveBeenCalled();
	});

	it('validates title, year and type', async () => {
		expect((await call({})).status).toHaveBeenCalledWith(400);
		expect((await call({ title: 'Dune', year: '21' })).status).toHaveBeenCalledWith(400);
		expect((await call({ title: 'Dune', type: 'anime' })).status).toHaveBeenCalledWith(400);
	});

	it('passes the parsed query to the resolver and returns its answer', async () => {
		vi.mocked(resolveTitle).mockResolvedValue({
			match: null,
			confidence: 'none',
			candidates: [],
		});
		const res = await call({ title: ' Saw IV ', year: '2007', type: 'movie' });
		expect(resolveTitle).toHaveBeenCalledWith({ title: 'Saw IV', year: 2007, type: 'movie' });
		expect(res.status).toHaveBeenCalledWith(200);
	});
});
