import handler from '@/pages/api/stremio-ad/[userid]/catalog/other/ad-casted-other.json';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getAllDebridDMMLibrary } from '@/utils/allDebridCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/allDebridCastCatalogHelper');

const mockRepository = vi.mocked(repository);
const mockGetAllDebridDMMLibrary = vi.mocked(getAllDebridDMMLibrary);

describe('/api/stremio-ad/[userid]/catalog/other/ad-casted-other.json', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getAllDebridCastProfile = vi.fn();
	});

	it('sets CORS header', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 400 when userid is missing', async () => {
		const req = createMockRequest({ query: {} });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns empty metas when no profile found', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.metas).toEqual([]);
	});

	it('returns the first page of the library with hasMore', async () => {
		const mockMetas = [{ id: 'dmm-ad:123', type: 'other', name: 'Test' }];
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
		mockGetAllDebridDMMLibrary.mockResolvedValue({ metas: mockMetas, hasMore: true } as any);
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockGetAllDebridDMMLibrary).toHaveBeenCalledWith('test-key', 1);
		const data = res._getData() as any;
		expect(data.metas).toEqual(mockMetas);
		// Without hasMore a client has no reason to ask for page two.
		expect(data.hasMore).toBe(true);
		expect(data.cacheMaxAge).toBe(0);
	});

	it('returns 500 on error', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
		mockGetAllDebridDMMLibrary.mockRejectedValue(new Error('API error'));
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
