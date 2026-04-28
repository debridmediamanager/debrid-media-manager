import handler from '@/pages/api/stremio-tb/[userid]/meta/other/[id]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getTorBoxDMMTorrent } from '@/utils/torboxCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/torboxCastCatalogHelper');

const mockGetTorBoxDMMTorrent = vi.mocked(getTorBoxDMMTorrent);

describe('/api/stremio-tb/[userid]/meta/other/[id]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
	});

	it('sets CORS header', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tb:123' } });
		mockGetTorBoxDMMTorrent.mockResolvedValue({ data: { meta: null }, status: 200 } as any);
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
			query: { userid: 'user1', id: 'dmm-tb:123' },
		});
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.end).toHaveBeenCalled();
	});

	it('returns null meta when id does not start with dmm-tb:', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'tt1234567' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.meta).toBeNull();
	});

	it('strips .json suffix from id', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tb:123.json' } });
		mockGetTorBoxDMMTorrent.mockResolvedValue({ data: { meta: {} }, status: 200 } as any);
		await handler(req, res);
		expect(mockGetTorBoxDMMTorrent).toHaveBeenCalledWith('user1', '123');
	});

	it('returns 400 for invalid id format', async () => {
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tb' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.meta).toBeNull();
	});

	it('returns torrent meta on success', async () => {
		const mockData = { meta: { id: 'dmm-tb:123', type: 'other', name: 'Test Torrent' } };
		mockGetTorBoxDMMTorrent.mockResolvedValue({ data: mockData, status: 200 } as any);
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tb:123' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data).toEqual(mockData);
	});

	it('returns error from helper', async () => {
		mockGetTorBoxDMMTorrent.mockResolvedValue({ error: 'Not found', status: 404 } as any);
		const req = createMockRequest({ query: { userid: 'user1', id: 'dmm-tb:123' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(404);
	});
});
