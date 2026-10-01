import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRecentlyUpdatedAnime = vi.hoisted(() => vi.fn());
vi.mock('@/services/repository', () => ({ repository: { getRecentlyUpdatedAnime } }));
vi.mock('@/services/rateLimit/withRateLimit', () => ({
	RATE_LIMIT_CONFIGS: { animeEntries: {} },
	withIpRateLimit: (h: unknown) => h,
}));

import handler from '@/pages/api/anime/recent';

function call(method = 'GET') {
	const res: any = { headers: {} as Record<string, string> };
	res.setHeader = (k: string, v: string) => (res.headers[k] = v);
	res.status = (c: number) => ((res.code = c), res);
	res.json = (b: unknown) => ((res.body = b), res);
	return (handler as any)({ method }, res).then(() => res);
}

describe('/api/anime/recent', () => {
	beforeEach(() => {
		getRecentlyUpdatedAnime.mockReset();
	});

	it('answers the recently updated entries', async () => {
		getRecentlyUpdatedAnime.mockResolvedValue([{ anidb_id: 1 }]);
		const res = await call();
		expect(res.code).toBe(200);
		expect(res.body).toEqual({ results: [{ anidb_id: 1 }] });
	});

	it('rejects other methods', async () => {
		expect((await call('POST')).code).toBe(405);
	});

	it('answers 500 when the lookup fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		getRecentlyUpdatedAnime.mockRejectedValue(new Error('db down'));
		expect((await call()).code).toBe(500);
	});
});
