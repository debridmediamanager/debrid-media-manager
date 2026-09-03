import handler from '@/pages/api/stremio-oc/[userid]/catalog/other/oc-casted-other.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getOffcloudDMMLibrary } from '@/utils/offcloudCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/offcloudCastCatalogHelper', () => ({
	getOffcloudDMMLibrary: vi.fn(),
}));

const mockLibrary = vi.mocked(getOffcloudDMMLibrary);

describe('/api/stremio-oc/[userid]/catalog/other/oc-casted-other.json', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
	});

	it('returns the first page of the library', async () => {
		const data = {
			metas: [{ id: 'dmm-oc:r1', name: 'R', type: 'other' }],
			hasMore: true,
			cacheMaxAge: 0,
		};
		mockLibrary.mockResolvedValue({ data, status: 200 } as any);
		await handler(createMockRequest({ query: { userid: 'user1' } }), res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
		expect(mockLibrary).toHaveBeenCalledWith('user1', 1);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual(data);
	});

	it('returns 400 when userid is missing', async () => {
		await handler(createMockRequest({ query: {} }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('passes the helper error status through', async () => {
		mockLibrary.mockResolvedValue({ error: 'no profile', status: 401 } as any);
		await handler(createMockRequest({ query: { userid: 'user1' } }), res);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('returns 500 when the helper throws', async () => {
		mockLibrary.mockRejectedValue(new Error('boom'));
		await handler(createMockRequest({ query: { userid: 'user1' } }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('answers OPTIONS with 200', async () => {
		await handler(createMockRequest({ method: 'OPTIONS', query: { userid: 'user1' } }), res);
		expect(res.status).toHaveBeenCalledWith(200);
	});
});
