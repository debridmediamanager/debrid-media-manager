/**
 * The endpoints /api-docs lists side by side, limited alike.
 *
 * The three batch endpoints a sponsor's tools call with `x-api-key` cap an
 * address at 2,500 items a minute each, but `/api/torrents/identify` kept 20
 * calls of 500 hashes, four times its siblings. And the two plugin routes, the
 * only `?apikey=` routes with no per-address gate in front of their key lookup,
 * had no limit at all.
 *
 * Driven through the routes as exported, with the real limiter (its in-memory
 * backend, since the test has no Redis). A refused call counts, so a call
 * without a key spends the budget the same as one with.
 */
import embyHandler from '@/pages/api/emby-plugins/[...route]';
import pluginsHandler from '@/pages/api/plugins/[...route]';
import sponsorAvailabilityHandler from '@/pages/api/sponsor/availability';
import sponsorIdentifyHandler from '@/pages/api/sponsor/identify';
import sponsorMediaInfoHandler from '@/pages/api/sponsor/mediainfo';
import torrentsIdentifyHandler from '@/pages/api/torrents/identify';
import { RATE_LIMIT_CONFIGS } from '@/services/rateLimit/configs';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { NextApiHandler } from 'next';
import { describe, expect, it, vi } from 'vitest';

vi.unmock('@/services/rateLimit/withRateLimit');
vi.mock('@/services/repository');
vi.mock('@/services/newznab/store', () => ({ getStoredObject: vi.fn() }));

let address = 0;

/** Calls a route from one fresh address until it refuses; returns how many it served. */
async function servedBeforeRefusal(handler: NextApiHandler, url: string, method = 'GET') {
	const ip = `198.51.100.${++address}`;
	for (let served = 0; served < 100; served++) {
		const res = createMockResponse();
		await handler(
			createMockRequest({
				method,
				url,
				query: { route: url.split('/').slice(3) },
				headers: { 'cf-connecting-ip': ip },
			}),
			res
		);
		if (res._getStatusCode() === 429) return served;
	}
	return Infinity;
}

describe('rate limits on the documented API', () => {
	it('caps every sponsor batch endpoint at 2,500 items a minute', async () => {
		const perMinute = (calls: number, batch: number) => calls * batch;
		expect(
			perMinute(
				await servedBeforeRefusal(sponsorIdentifyHandler, '/api/sponsor/identify', 'POST'),
				500
			)
		).toBe(2500);
		expect(
			perMinute(
				await servedBeforeRefusal(
					sponsorAvailabilityHandler,
					'/api/sponsor/availability',
					'POST'
				),
				100
			)
		).toBe(2500);
		expect(
			perMinute(
				await servedBeforeRefusal(
					sponsorMediaInfoHandler,
					'/api/sponsor/mediainfo',
					'POST'
				),
				100
			)
		).toBe(2500);
		expect(
			perMinute(
				await servedBeforeRefusal(
					torrentsIdentifyHandler,
					'/api/torrents/identify',
					'POST'
				),
				500
			)
		).toBe(2500);
	});

	it('gates both plugin routes per address like the other ?apikey= routes', async () => {
		const sabLike = RATE_LIMIT_CONFIGS.default.rateLimit;
		expect(await servedBeforeRefusal(pluginsHandler, '/api/plugins/manifest.json')).toBe(
			sabLike
		);
		expect(await servedBeforeRefusal(embyHandler, '/api/emby-plugins/')).toBe(sabLike);
	});
});
