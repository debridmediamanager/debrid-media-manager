import handler from '@/pages/api/stremio-tr/[userid]/meta/other/[id]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getTorrinDMMTorrent } from '@/utils/torrinCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/torrinCastCatalogHelper');

const mockGetTorrinDMMTorrent = vi.mocked(getTorrinDMMTorrent);

describe('/api/stremio-tr/[userid]/meta/other/[id]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
	});

	it('sets CORS header', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tr:123' } });
		mockGetTorrinDMMTorrent.mockResolvedValue({ data: { meta: null }, status: 200 } as any);
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 400 when userid or id is missing', async () => {
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 200 for OPTIONS request', async () => {
		const req = createMockRequest({
			method: 'OPTIONS',
			query: { userid: 'user1', id: 'dmm-tr:123' },
		});
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.end).toHaveBeenCalled();
	});

	it('returns null meta when id does not start with dmm-tr:', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'tt1234567' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.meta).toBeNull();
		expect(mockGetTorrinDMMTorrent).not.toHaveBeenCalled();
	});

	it('strips .json suffix from id', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tr:123.json' } });
		mockGetTorrinDMMTorrent.mockResolvedValue({ data: { meta: {} }, status: 200 } as any);
		await handler(req, res);
		expect(mockGetTorrinDMMTorrent).toHaveBeenCalledWith('user1', '123');
	});

	it('returns null meta for invalid id format', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tr' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.meta).toBeNull();
	});

	it('returns torrent meta on success', async () => {
		const mockData = { meta: { id: 'dmm-tr:123', type: 'other', name: 'Test Torrent' } };
		mockGetTorrinDMMTorrent.mockResolvedValue({ data: mockData, status: 200 } as any);
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tr:123' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data).toEqual(mockData);
	});

	it('returns error from helper', async () => {
		mockGetTorrinDMMTorrent.mockResolvedValue({ error: 'Not found', status: 404 } as any);
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tr:123' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(404);
	});
});
