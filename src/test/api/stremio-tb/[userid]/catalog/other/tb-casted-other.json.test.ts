import handler from '@/pages/api/stremio-tb/[userid]/catalog/other/tb-casted-other.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getTorBoxDMMLibrary } from '@/utils/torboxCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/torboxCastCatalogHelper');

const mockGetTorBoxDMMLibrary = vi.mocked(getTorBoxDMMLibrary);

describe('/api/stremio-tb/[userid]/catalog/other/tb-casted-other.json', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
	});

	it('sets CORS header', async () => {
		mockGetTorBoxDMMLibrary.mockResolvedValue({ data: { metas: [] }, status: 200 } as any);
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 400 when userid is missing', async () => {
		const req = createMockRequest({ query: {} });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 200 for OPTIONS request', async () => {
		const req = createMockRequest({ method: 'OPTIONS', query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.end).toHaveBeenCalled();
	});

	it('returns library data on success', async () => {
		const mockData = { metas: [{ id: 'dmm-tb:123', type: 'other' }], cacheMaxAge: 0 };
		mockGetTorBoxDMMLibrary.mockResolvedValue({ data: mockData, status: 200 } as any);
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(mockGetTorBoxDMMLibrary).toHaveBeenCalledWith('user1', 1);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data).toEqual(mockData);
	});

	it('returns error status from helper', async () => {
		mockGetTorBoxDMMLibrary.mockResolvedValue({ error: 'No profile', status: 401 } as any);
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
