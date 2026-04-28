import handler from '@/pages/api/stremio-tb/[userid]/catalog/other/tb-casted-other/[skip]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getTorBoxDMMLibrary, PAGE_SIZE } from '@/utils/torboxCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/torboxCastCatalogHelper', async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		PAGE_SIZE: 12,
		getTorBoxDMMLibrary: vi.fn(),
	};
});

const mockGetTorBoxDMMLibrary = vi.mocked(getTorBoxDMMLibrary);

describe('/api/stremio-tb/[userid]/catalog/other/tb-casted-other/[skip]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
	});

	it('sets CORS header', async () => {
		mockGetTorBoxDMMLibrary.mockResolvedValue({ data: { metas: [] }, status: 200 } as any);
		const req = createMockRequest({ query: { userid: 'user1', skip: '0' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 400 when userid is missing', async () => {
		const req = createMockRequest({ query: { skip: '0' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 when skip is missing', async () => {
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 200 for OPTIONS request', async () => {
		const req = createMockRequest({
			method: 'OPTIONS',
			query: { userid: 'user1', skip: '0' },
		});
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.end).toHaveBeenCalled();
	});

	it('returns 400 for invalid skip value', async () => {
		const req = createMockRequest({ query: { userid: 'user1', skip: 'invalid' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('converts skip to page number', async () => {
		const mockData = { metas: [], cacheMaxAge: 0 };
		mockGetTorBoxDMMLibrary.mockResolvedValue({ data: mockData, status: 200 } as any);
		const req = createMockRequest({ query: { userid: 'user1', skip: '24' } });
		await handler(req, res);
		const expectedPage = Math.floor(24 / PAGE_SIZE) + 1;
		expect(mockGetTorBoxDMMLibrary).toHaveBeenCalledWith('user1', expectedPage);
	});

	it('handles skip with .json suffix', async () => {
		const mockData = { metas: [], cacheMaxAge: 0 };
		mockGetTorBoxDMMLibrary.mockResolvedValue({ data: mockData, status: 200 } as any);
		const req = createMockRequest({ query: { userid: 'user1', skip: '12.json' } });
		await handler(req, res);
		expect(mockGetTorBoxDMMLibrary).toHaveBeenCalledWith('user1', 2);
	});

	it('returns library data on success', async () => {
		const mockData = { metas: [{ id: 'dmm-tb:456', type: 'other' }], cacheMaxAge: 0 };
		mockGetTorBoxDMMLibrary.mockResolvedValue({ data: mockData, status: 200 } as any);
		const req = createMockRequest({ query: { userid: 'user1', skip: '0' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data).toEqual(mockData);
	});

	it('returns error status from helper', async () => {
		mockGetTorBoxDMMLibrary.mockResolvedValue({ error: 'No profile', status: 401 } as any);
		const req = createMockRequest({ query: { userid: 'user1', skip: '0' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
