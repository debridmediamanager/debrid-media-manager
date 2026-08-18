import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRAP_POOL } from './canary';
import { checkCanary, respondAsNeverScraped } from './canaryGuard';

const { mockRecord } = vi.hoisted(() => ({ mockRecord: vi.fn() }));

vi.mock('@/services/canary/canaryStore', () => ({
	getCanaryStore: () => ({ record: mockRecord }),
}));

describe('checkCanary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('ignores ids a real user can reach', async () => {
		const req = createMockRequest({ url: '/api/torrents/movie?imdbId=tt0111161' });

		expect(await checkCanary(req, 'tt0111161')).toBeNull();
		expect(mockRecord).not.toHaveBeenCalled();
	});

	it('records a trap hit against the Cloudflare client ip', async () => {
		const trap = TRAP_POOL[0];
		const req = createMockRequest({
			url: `/api/torrents/movie?imdbId=${trap}&page=0`,
			headers: { 'cf-connecting-ip': '203.0.113.9' },
		});

		expect(await checkCanary(req, trap)).toBe('trap');
		expect(mockRecord).toHaveBeenCalledWith('203.0.113.9', {
			imdbId: trap,
			kind: 'trap',
			path: '/api/torrents/movie',
		});
	});

	it('falls back through the proxy headers for identity', async () => {
		const req = createMockRequest({
			url: '/api/torrents/tv',
			headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' },
		});

		await checkCanary(req, 'tt900000123');
		expect(mockRecord).toHaveBeenCalledWith('198.51.100.4', expect.anything());
	});

	it('still reports the hit when the store is unreachable', async () => {
		mockRecord.mockRejectedValueOnce(new Error('redis down'));
		const req = createMockRequest({ url: '/api/torrents/movie' });

		expect(await checkCanary(req, 'tt900000123')).toBe('void');
	});
});

describe('respondAsNeverScraped', () => {
	it('answers exactly as a genuine never-scraped title does', () => {
		const res = createMockResponse();

		respondAsNeverScraped(res);

		expect(res.setHeader).toHaveBeenCalledWith('status', 'requested');
		expect(res.status).toHaveBeenCalledWith(204);
		expect(res.end).toHaveBeenCalled();
		expect(res.json).not.toHaveBeenCalled();
	});
});
