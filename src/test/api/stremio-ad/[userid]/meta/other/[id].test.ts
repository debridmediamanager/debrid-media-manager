import handler from '@/pages/api/stremio-ad/[userid]/meta/other/[id]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getAllDebridDMMTorrent } from '@/utils/allDebridCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/allDebridCastCatalogHelper');

const mockRepository = vi.mocked(repository);
const mockGetAllDebridDMMTorrent = vi.mocked(getAllDebridDMMTorrent);

describe('/api/stremio-ad/[userid]/meta/other/[id]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getAllDebridCastProfile = vi.fn();
	});

	it('sets CORS header', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-ad:123' } });
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetAllDebridDMMTorrent.mockResolvedValue({ data: { meta: null }, status: 200 } as any);
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 400 when userid or id is missing', async () => {
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns null meta when id does not start with dmm-ad:', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'tt1234567' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.meta).toBeNull();
	});

	it('strips .json suffix from id', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-ad:123.json' } });
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetAllDebridDMMTorrent.mockResolvedValue({ data: { meta: {} }, status: 200 } as any);
		await handler(req, res);
		expect(mockGetAllDebridDMMTorrent).toHaveBeenCalledWith('key', '123', 'user1');
	});

	it('returns 401 when no profile exists', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-ad:123' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('returns torrent meta on success', async () => {
		const mockData = { meta: { id: 'dmm-ad:123', type: 'other', name: 'Test Torrent' } };
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetAllDebridDMMTorrent.mockResolvedValue({ data: mockData, status: 200 } as any);
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-ad:123' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data).toEqual(mockData);
	});

	it('returns error from helper', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetAllDebridDMMTorrent.mockResolvedValue({ error: 'Not found', status: 404 } as any);
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-ad:123' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('returns 500 on exception', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetAllDebridDMMTorrent.mockRejectedValue(new Error('Unexpected'));
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-ad:123' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
