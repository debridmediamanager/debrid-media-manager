import { createMockResponse } from '@/test/utils/api';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_CONFIGS } from '@/services/rateLimit/middlewareRateLimiter';

// setup.ts stubs this module out so wrapped handlers pass through; the real
// implementation is what is under test here.
vi.unmock('@/services/rateLimit/withRateLimit');

import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';

beforeAll(() => {
	// No REDIS_URL means the hybrid limiter uses its in-memory path, and no
	// whitelist means the identifiers below are actually counted.
	delete process.env.REDIS_URL;
	delete process.env.RATE_LIMIT_WHITELIST_IPS;
});

describe('Newznab rate limit configs', () => {
	it('defines a search config and both grab configs', () => {
		expect(RATE_LIMIT_CONFIGS.newznabSearch).toEqual({
			name: 'newznabSearch',
			rateLimit: 30,
			windowSeconds: 60,
		});
		expect(RATE_LIMIT_CONFIGS.newznabGrab).toEqual({
			name: 'newznabGrab',
			rateLimit: 10,
			windowSeconds: 60,
		});
		expect(RATE_LIMIT_CONFIGS.newznabGrabDay).toEqual({
			name: 'newznabGrabDay',
			rateLimit: 150,
			windowSeconds: 86400,
		});
	});

	it('gives every config a distinct name', () => {
		// Two configs sharing a name share a counter, which silently merges their
		// budgets - the burst grab limit and the daily one would become one.
		const names = Object.values(RATE_LIMIT_CONFIGS).map((config) => config.name);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe('checkRateLimitFor', () => {
	let identifier: string;

	beforeEach(() => {
		// A fresh bucket per test: the in-memory limiter is a module singleton.
		identifier = `sponsor-${Math.random().toString(36).slice(2)}`;
	});

	it('returns true and sets the rate limit headers while under the limit', async () => {
		const res = createMockResponse();
		const config = { name: 'newznabTestUnder', rateLimit: 2, windowSeconds: 60 };

		expect(await checkRateLimitFor(identifier, config, res)).toBe(true);

		expect(res._getHeaders()['X-RateLimit-Limit']).toBe('2');
		expect(res._getHeaders()['X-RateLimit-Remaining']).toBe('1');
		expect(res._getHeaders()['X-RateLimit-Reset']).toBeDefined();
		expect(res._getHeaders()['Retry-After']).toBeUndefined();
	});

	it('returns false with a Retry-After header once the limit is exceeded', async () => {
		const config = { name: 'newznabTestOver', rateLimit: 2, windowSeconds: 60 };

		expect(await checkRateLimitFor(identifier, config, createMockResponse())).toBe(true);
		expect(await checkRateLimitFor(identifier, config, createMockResponse())).toBe(true);

		const res = createMockResponse();
		expect(await checkRateLimitFor(identifier, config, res)).toBe(false);

		expect(res._getHeaders()['X-RateLimit-Remaining']).toBe('0');
		expect(Number(res._getHeaders()['Retry-After'])).toBeGreaterThan(0);
	});

	it('writes no body on refusal — the caller answers in its own protocol', async () => {
		const config = { name: 'newznabTestNoBody', rateLimit: 1, windowSeconds: 60 };
		await checkRateLimitFor(identifier, config, createMockResponse());

		const res = createMockResponse();
		expect(await checkRateLimitFor(identifier, config, res)).toBe(false);

		expect(res.status).not.toHaveBeenCalled();
		expect(res.json).not.toHaveBeenCalled();
		expect(res.send).not.toHaveBeenCalled();
		expect(res.end).not.toHaveBeenCalled();
	});

	it('keeps the two grab budgets apart', async () => {
		// Same identifier, different config names: spending the burst budget must
		// not spend the daily one.
		const burst = { name: 'newznabTestBurst', rateLimit: 1, windowSeconds: 60 };
		const day = { name: 'newznabTestDay', rateLimit: 1, windowSeconds: 86400 };

		expect(await checkRateLimitFor(identifier, burst, createMockResponse())).toBe(true);
		expect(await checkRateLimitFor(identifier, burst, createMockResponse())).toBe(false);
		expect(await checkRateLimitFor(identifier, day, createMockResponse())).toBe(true);
	});

	it('tracks identifiers independently', async () => {
		const config = { name: 'newznabTestPerIdentifier', rateLimit: 1, windowSeconds: 60 };

		expect(await checkRateLimitFor(identifier, config, createMockResponse())).toBe(true);
		expect(await checkRateLimitFor(identifier, config, createMockResponse())).toBe(false);
		expect(await checkRateLimitFor(`${identifier}-other`, config, createMockResponse())).toBe(
			true
		);
	});
});
