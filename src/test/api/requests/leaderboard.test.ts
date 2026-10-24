import handler from '@/pages/api/requests/leaderboard';
import { leaderboard } from '@/services/fulfillerRewards';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/fulfillerRewards', () => ({ leaderboard: vi.fn() }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(leaderboard).mockResolvedValue([{ name: null, sends: 4 }]);
});

describe('GET /api/requests/leaderboard', () => {
	it('answers this week and all time', async () => {
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'GET' }) as any, res as any);
		expect((res.status as any).mock.calls[0][0]).toBe(200);
		const since = vi.mocked(leaderboard).mock.calls.map((c) => c[0]);
		expect(since).toContain(null);
		expect(since.some((d) => d instanceof Date)).toBe(true);
	});
});
