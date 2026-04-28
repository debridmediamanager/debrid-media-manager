import handler from '@/pages/api/stremio-tb/[userid]/catalog/series/tb-casted-shows.json';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

describe('/api/stremio-tb/[userid]/catalog/series/tb-casted-shows.json', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.fetchTorBoxCastedShows = vi.fn();
	});

	it('sets CORS header', async () => {
		mockRepository.fetchTorBoxCastedShows = vi.fn().mockResolvedValue([]);
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 200 for OPTIONS request', async () => {
		const req = createMockRequest({ method: 'OPTIONS', query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.end).toHaveBeenCalled();
	});

	it('returns 400 when userid is missing', async () => {
		const req = createMockRequest({ query: {} });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns metas with poster URLs', async () => {
		mockRepository.fetchTorBoxCastedShows = vi
			.fn()
			.mockResolvedValue(['tt1111111', 'tt2222222']);
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.metas).toEqual([
			{
				id: 'tt1111111',
				type: 'series',
				poster: 'https://images.metahub.space/poster/small/tt1111111/img',
			},
			{
				id: 'tt2222222',
				type: 'series',
				poster: 'https://images.metahub.space/poster/small/tt2222222/img',
			},
		]);
		expect(data.cacheMaxAge).toBe(0);
	});

	it('returns 500 on error', async () => {
		mockRepository.fetchTorBoxCastedShows = vi.fn().mockRejectedValue(new Error('DB error'));
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
