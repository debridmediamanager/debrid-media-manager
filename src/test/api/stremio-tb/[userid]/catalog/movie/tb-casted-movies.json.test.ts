import handler from '@/pages/api/stremio-tb/[userid]/catalog/movie/tb-casted-movies.json';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

describe('/api/stremio-tb/[userid]/catalog/movie/tb-casted-movies.json', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.fetchTorBoxCastedMovies = vi.fn();
	});

	it('sets CORS header', async () => {
		mockRepository.fetchTorBoxCastedMovies = vi.fn().mockResolvedValue([]);
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
		mockRepository.fetchTorBoxCastedMovies = vi
			.fn()
			.mockResolvedValue(['tt1234567', 'tt7654321']);
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.metas).toEqual([
			{
				id: 'tt1234567',
				type: 'movie',
				poster: 'https://images.metahub.space/poster/small/tt1234567/img',
			},
			{
				id: 'tt7654321',
				type: 'movie',
				poster: 'https://images.metahub.space/poster/small/tt7654321/img',
			},
		]);
		expect(data.cacheMaxAge).toBe(0);
	});

	it('returns 500 on error', async () => {
		mockRepository.fetchTorBoxCastedMovies = vi.fn().mockRejectedValue(new Error('DB error'));
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
