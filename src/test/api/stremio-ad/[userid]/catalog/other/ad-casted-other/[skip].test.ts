import handler from '@/pages/api/stremio-ad/[userid]/catalog/other/ad-casted-other/[skip]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getAllDebridDMMLibrary } from '@/utils/allDebridCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/allDebridCastCatalogHelper', async () => {
	const actual = await vi.importActual<typeof import('@/utils/allDebridCastCatalogHelper')>(
		'@/utils/allDebridCastCatalogHelper'
	);
	return { ...actual, getAllDebridDMMLibrary: vi.fn() };
});

const mockRepository = vi.mocked(repository);
const mockGetAllDebridDMMLibrary = vi.mocked(getAllDebridDMMLibrary);

describe('/api/stremio-ad/[userid]/catalog/other/ad-casted-other/[skip]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getAllDebridCastProfile = vi.fn();
		mockGetAllDebridDMMLibrary.mockResolvedValue({ metas: [], hasMore: false });
	});

	it('sets CORS header', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', skip: 'skip=0.json' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 400 when userid is missing', async () => {
		const req = createMockRequest({ query: { skip: 'skip=0.json' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns empty metas when no profile found', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', skip: 'skip=0.json' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect((res._getData() as any).metas).toEqual([]);
	});

	// Regression: the skip extra arrives as the path segment `skip=12.json`, and
	// `parseInt` on that is NaN. That NaN reached the helper as a page number and
	// sliced the library down to nothing, so an AllDebrid library stopped dead
	// after its first 12 entries.
	it.each([
		['skip=12.json', 2],
		['skip=24.json', 3],
		['skip=0.json', 1],
		['12.json', 2],
		['24', 3],
	])('resolves the %s extra to page %i', async (skip, page) => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
		const req = createMockRequest({ query: { userid: 'user1', skip } });
		await handler(req, res);
		expect(mockGetAllDebridDMMLibrary).toHaveBeenCalledWith('test-key', page);
	});

	it('returns metas and hasMore from the helper', async () => {
		const metas = [{ id: 'dmm-ad:456', type: 'other', name: 'Test2' }];
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
		mockGetAllDebridDMMLibrary.mockResolvedValue({ metas, hasMore: true } as any);
		const req = createMockRequest({ query: { userid: 'user1', skip: 'skip=24.json' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.metas).toEqual(metas);
		expect(data.hasMore).toBe(true);
		expect(data.cacheMaxAge).toBe(0);
	});

	it('defaults to the first page when skip is not a string', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(mockGetAllDebridDMMLibrary).toHaveBeenCalledWith('test-key', 1);
	});

	it('returns 500 on error', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
		mockGetAllDebridDMMLibrary.mockRejectedValue(new Error('API error'));
		const req = createMockRequest({ query: { userid: 'user1', skip: 'skip=0.json' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
