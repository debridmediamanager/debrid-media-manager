import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TorBoxRateLimitError, _testing } from './torbox';

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			torboxHostname: 'https://api.torbox.test',
		},
	}),
}));

vi.mock('@/utils/delay', () => ({
	delay: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 10))),
}));

describe('TorBox rate limiting internals', () => {
	beforeEach(() => {
		_testing.resetState();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('getEndpointKey', () => {
		it('returns "requestdl" for requestdl URLs', () => {
			expect(_testing.getEndpointKey('/v1/api/torrents/requestdl')).toBe('requestdl');
			expect(
				_testing.getEndpointKey('https://api.torbox.app/v1/api/torrents/requestdl?token=x')
			).toBe('requestdl');
		});

		it('returns "createtorrent" for createtorrent URLs', () => {
			expect(_testing.getEndpointKey('/v1/api/torrents/createtorrent')).toBe('createtorrent');
		});

		it('returns "default" for general endpoints', () => {
			expect(_testing.getEndpointKey('/v1/api/torrents/mylist')).toBe('default');
			expect(_testing.getEndpointKey('/v1/api/torrents/checkcached')).toBe('default');
			expect(_testing.getEndpointKey('/v1/api/user/me')).toBe('default');
		});

		it('returns "default" for undefined/empty URLs', () => {
			expect(_testing.getEndpointKey(undefined)).toBe('default');
			expect(_testing.getEndpointKey('')).toBe('default');
		});
	});

	describe('ENDPOINT_LIMITS', () => {
		it('has conservative limits below actual TorBox thresholds', () => {
			expect(_testing.ENDPOINT_LIMITS.requestdl).toBe(80);
			expect(_testing.ENDPOINT_LIMITS.createtorrent).toBe(50);
			expect(_testing.ENDPOINT_LIMITS.default).toBe(250);
		});

		it('requestdl limit is well below the empirical ~100-190 threshold', () => {
			expect(_testing.ENDPOINT_LIMITS.requestdl).toBeLessThan(100);
		});

		it('default limit is below the 300/min per-endpoint limit', () => {
			expect(_testing.ENDPOINT_LIMITS.default).toBeLessThan(300);
		});
	});

	describe('MAX_GLOBAL_CONCURRENT', () => {
		it('is set below the 40-concurrent cross-endpoint contamination threshold', () => {
			expect(_testing.MAX_GLOBAL_CONCURRENT).toBeLessThan(40);
			expect(_testing.MAX_GLOBAL_CONCURRENT).toBe(15);
		});
	});

	describe('DEFAULT_RETRY_AFTER_MS', () => {
		it('matches TorBox 5-minute recovery window', () => {
			expect(_testing.DEFAULT_RETRY_AFTER_MS).toBe(300_000);
		});
	});

	describe('parseRetryAfterMs', () => {
		it('parses numeric Retry-After header to milliseconds', () => {
			const error = { response: { headers: { 'retry-after': '300' } } };
			expect(_testing.parseRetryAfterMs(error)).toBe(300_000);
		});

		it('parses small Retry-After values', () => {
			const error = { response: { headers: { 'retry-after': '60' } } };
			expect(_testing.parseRetryAfterMs(error)).toBe(60_000);
		});

		it('returns undefined when header is missing', () => {
			expect(_testing.parseRetryAfterMs({ response: { headers: {} } })).toBeUndefined();
			expect(_testing.parseRetryAfterMs({ response: {} })).toBeUndefined();
			expect(_testing.parseRetryAfterMs({})).toBeUndefined();
		});

		it('returns undefined for non-numeric Retry-After', () => {
			const error = { response: { headers: { 'retry-after': 'invalid' } } };
			expect(_testing.parseRetryAfterMs(error)).toBeUndefined();
		});

		it('returns undefined for zero or negative values', () => {
			expect(
				_testing.parseRetryAfterMs({ response: { headers: { 'retry-after': '0' } } })
			).toBeUndefined();
			expect(
				_testing.parseRetryAfterMs({ response: { headers: { 'retry-after': '-1' } } })
			).toBeUndefined();
		});
	});

	describe('calculateRetryDelay', () => {
		it('uses retryAfterMs when provided', () => {
			vi.spyOn(Math, 'random').mockReturnValue(0.5);
			const delay = _testing.calculateRetryDelay(1, 300_000);
			expect(delay).toBeGreaterThanOrEqual(300_000);
			expect(delay).toBeLessThanOrEqual(305_000);
		});

		it('uses exponential backoff when no retryAfterMs', () => {
			vi.spyOn(Math, 'random').mockReturnValue(0.5);
			const delay1 = _testing.calculateRetryDelay(1);
			const delay2 = _testing.calculateRetryDelay(2);
			const delay3 = _testing.calculateRetryDelay(3);
			expect(delay1).toBeLessThan(delay2);
			expect(delay2).toBeLessThan(delay3);
		});

		it('caps exponential backoff at DEFAULT_RETRY_AFTER_MS', () => {
			vi.spyOn(Math, 'random').mockReturnValue(0.5);
			const delay = _testing.calculateRetryDelay(20);
			expect(delay).toBeLessThanOrEqual(_testing.DEFAULT_RETRY_AFTER_MS * 1.2);
		});

		it('adds jitter to prevent thundering herd', () => {
			vi.spyOn(Math, 'random').mockReturnValueOnce(0.0).mockReturnValueOnce(1.0);
			const low = _testing.calculateRetryDelay(2);
			const high = _testing.calculateRetryDelay(2);
			expect(low).not.toBe(high);
		});
	});

	describe('concurrency semaphore', () => {
		it('tracks concurrent slots', async () => {
			expect(_testing.globalConcurrent).toBe(0);
			await _testing.acquireConcurrencySlot();
			expect(_testing.globalConcurrent).toBe(1);
			await _testing.acquireConcurrencySlot();
			expect(_testing.globalConcurrent).toBe(2);
			_testing.releaseConcurrencySlot();
			expect(_testing.globalConcurrent).toBe(1);
			_testing.releaseConcurrencySlot();
			expect(_testing.globalConcurrent).toBe(0);
		});

		it('does not go below zero on extra releases', () => {
			_testing.releaseConcurrencySlot();
			expect(_testing.globalConcurrent).toBe(0);
			_testing.releaseConcurrencySlot();
			expect(_testing.globalConcurrent).toBe(0);
		});

		it('blocks when at max concurrency and unblocks on release', async () => {
			_testing.globalConcurrent = _testing.MAX_GLOBAL_CONCURRENT;

			let acquired = false;
			const acquirePromise = _testing.acquireConcurrencySlot().then(() => {
				acquired = true;
			});

			// Should not have acquired yet
			await vi.advanceTimersByTimeAsync(0);
			expect(acquired).toBe(false);

			// Release one slot
			_testing.releaseConcurrencySlot();
			await vi.advanceTimersByTimeAsync(0);
			expect(acquired).toBe(true);

			await acquirePromise;
		});

		it('resolves waiters in FIFO order', async () => {
			_testing.globalConcurrent = _testing.MAX_GLOBAL_CONCURRENT;

			const order: number[] = [];
			const p1 = _testing.acquireConcurrencySlot().then(() => order.push(1));
			const p2 = _testing.acquireConcurrencySlot().then(() => order.push(2));

			_testing.releaseConcurrencySlot();
			await vi.advanceTimersByTimeAsync(0);
			_testing.releaseConcurrencySlot();
			await vi.advanceTimersByTimeAsync(0);

			await Promise.all([p1, p2]);
			expect(order).toEqual([1, 2]);
		});
	});

	describe('enforceEndpointLimit', () => {
		it('allows requests within the per-endpoint budget', async () => {
			const start = Date.now();
			await _testing.enforceEndpointLimit('default');
			expect(Date.now() - start).toBeLessThan(100);
			expect(_testing.endpointTimestamps['default']).toHaveLength(1);
		});

		it('tracks timestamps per endpoint independently', async () => {
			await _testing.enforceEndpointLimit('requestdl');
			await _testing.enforceEndpointLimit('default');
			await _testing.enforceEndpointLimit('createtorrent');

			expect(_testing.endpointTimestamps['requestdl']).toHaveLength(1);
			expect(_testing.endpointTimestamps['default']).toHaveLength(1);
			expect(_testing.endpointTimestamps['createtorrent']).toHaveLength(1);
		});

		it('uses default limit for unknown endpoint keys', async () => {
			await _testing.enforceEndpointLimit('unknown_endpoint');
			expect(_testing.endpointTimestamps['unknown_endpoint']).toHaveLength(1);
		});

		it('prunes timestamps older than 60 seconds', async () => {
			const timestamps = [Date.now() - 120_000, Date.now() - 90_000, Date.now() - 30_000];
			_testing.endpointTimestamps['default'] = [...timestamps];

			await _testing.enforceEndpointLimit('default');

			// Old timestamps should be pruned, only the recent one + the new one remain
			expect(_testing.endpointTimestamps['default'].length).toBe(2);
		});

		it('respects global pause from 429', async () => {
			vi.useRealTimers();
			// Set a global pause 50ms in the future
			_testing.globalPausedUntil = Date.now() + 50;

			const start = Date.now();
			await _testing.enforceEndpointLimit('default');
			const elapsed = Date.now() - start;

			// Should have waited at least ~50ms (but the mock delay caps at 10ms)
			expect(elapsed).toBeGreaterThanOrEqual(5);
		});
	});

	describe('resetState', () => {
		it('clears all rate limiting state', async () => {
			_testing.globalConcurrent = 5;
			_testing.globalPausedUntil = Date.now() + 60000;
			_testing.endpointTimestamps['requestdl'] = [Date.now()];
			_testing.endpointTimestamps['default'] = [Date.now(), Date.now()];
			_testing.concurrencyWaiters.push(() => {});

			_testing.resetState();

			expect(_testing.globalConcurrent).toBe(0);
			expect(_testing.globalPausedUntil).toBe(0);
			expect(Object.keys(_testing.endpointTimestamps)).toHaveLength(0);
			expect(_testing.concurrencyWaiters).toHaveLength(0);
		});
	});

	describe('TorBoxRateLimitError', () => {
		it('has correct name and default message', () => {
			const error = new TorBoxRateLimitError();
			expect(error.name).toBe('TorBoxRateLimitError');
			expect(error.message).toContain('rate limit');
		});

		it('accepts custom message', () => {
			const error = new TorBoxRateLimitError('custom');
			expect(error.message).toBe('custom');
		});

		it('is an instance of Error', () => {
			expect(new TorBoxRateLimitError()).toBeInstanceOf(Error);
		});
	});
});
