import { TorBoxRateLimitError } from '@/services/torbox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnifiedRateLimiter, getGlobalRateLimiter } from './UnifiedRateLimiter';

describe('UnifiedRateLimiter', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	// The service clients run their own retry ladders. When one of them gives up
	// and throws a typed error, retrying out here just multiplies the ladder:
	// a TorBox 429 already cost 4 attempts across up to 15 minutes of 5-minute
	// pauses, and a further 3 rounds stretched that to roughly an hour. The
	// error carries no `response`, so the "network errors are retryable" branch
	// used to claim it.
	it('does not retry an error a lower layer already gave up on', async () => {
		const limiter = new UnifiedRateLimiter();
		limiter.updateConfig('torbox', {
			maxRequestsPerMinute: 60000,
			maxConcurrent: 1,
			retryAttempts: 3,
			backoffMultiplier: 1,
			jitterRange: 0,
			burstSize: 10,
		});

		const attempt = vi.fn(async () => {
			throw new TorBoxRateLimitError();
		});

		await expect(limiter.execute('torbox', 'tb-page-0', attempt)).rejects.toBeInstanceOf(
			TorBoxRateLimitError
		);
		expect(attempt).toHaveBeenCalledTimes(1);
	});

	// A genuine network error still has no `response` and must stay retryable -
	// that is the case the branch was written for.
	it('still retries a genuine network error', async () => {
		const limiter = new UnifiedRateLimiter();
		limiter.updateConfig('torbox', {
			maxRequestsPerMinute: 60000,
			maxConcurrent: 1,
			retryAttempts: 2,
			backoffMultiplier: 1,
			jitterRange: 0,
			burstSize: 10,
		});

		const attempt = vi.fn(async () => {
			throw new Error('socket hang up');
		});

		await expect(limiter.execute('torbox', 'tb-page-0', attempt)).rejects.toThrow(
			'socket hang up'
		);
		expect(attempt).toHaveBeenCalledTimes(3);
	});

	it('prioritizes higher priority requests', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

		const limiter = new UnifiedRateLimiter();
		limiter.updateConfig('realdebrid', {
			maxRequestsPerMinute: 60000,
			maxConcurrent: 1,
			retryAttempts: 0,
			backoffMultiplier: 1,
			jitterRange: 0,
			burstSize: 2,
		});

		const order: string[] = [];
		const high = limiter.execute(
			'realdebrid',
			'high',
			async () => {
				order.push('high');
				return 'HIGH';
			},
			5
		);
		const low = limiter.execute(
			'realdebrid',
			'low',
			async () => {
				order.push('low');
				return 'LOW';
			},
			0
		);

		const combined = Promise.all([high, low]);
		await vi.runAllTimersAsync();
		await combined;
		expect(order).toEqual(['high', 'low']);
	});

	it('retries retryable errors before succeeding', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		vi.spyOn(Math, 'random').mockReturnValue(0.5);

		const limiter = new UnifiedRateLimiter();
		limiter.updateConfig('realdebrid', {
			maxRequestsPerMinute: 60000,
			maxConcurrent: 1,
			retryAttempts: 2,
			backoffMultiplier: 1,
			jitterRange: 0,
			burstSize: 1,
		});

		let attempts = 0;
		const promise = limiter.execute('realdebrid', 'retryable', async () => {
			attempts++;
			if (attempts < 2) {
				const error: any = new Error('boom');
				error.response = { status: 500, headers: {} };
				return Promise.reject(error);
			}
			return 'success';
		});

		await vi.runAllTimersAsync();
		await expect(promise).resolves.toBe('success');
		expect(attempts).toBe(2);
	});

	it('executeBatch aggregates results and errors', async () => {
		const limiter = new UnifiedRateLimiter();
		limiter.updateConfig('realdebrid', {
			maxRequestsPerMinute: 60000,
			maxConcurrent: 2,
			retryAttempts: 0,
			backoffMultiplier: 1,
			jitterRange: 0,
			burstSize: 2,
		});

		const results = await limiter.executeBatch('realdebrid', [
			{ id: 'good', fn: async () => 'ok' },
			{ id: 'bad', fn: async () => Promise.reject(new Error('fail')) },
		]);

		expect(results.get('good')).toBe('ok');
		expect(results.get('bad')).toBeInstanceOf(Error);
	});

	it('reset restores token bucket and clears queues', async () => {
		const limiter = new UnifiedRateLimiter();
		limiter.updateConfig('realdebrid', {
			maxRequestsPerMinute: 60000,
			maxConcurrent: 1,
			retryAttempts: 0,
			backoffMultiplier: 1,
			jitterRange: 0,
			burstSize: 3,
		});

		await limiter.execute('realdebrid', 'single', async () => 'done');
		const preStats = limiter.getStats('realdebrid');
		expect(preStats.recentRequests).toBeGreaterThanOrEqual(1);

		limiter.reset('realdebrid');
		const postStats = limiter.getStats('realdebrid');
		expect(postStats.queueLength).toBe(0);
		expect(postStats.tokens).toBe(3);
	});

	it('getStats without service returns snapshot for all services', () => {
		const limiter = new UnifiedRateLimiter();
		const stats = limiter.getStats();
		expect(stats.realdebrid).toMatchObject({
			queueLength: 0,
			activeRequests: 0,
		});
		expect(stats.alldebrid).toBeDefined();
		expect(stats.torbox).toBeDefined();
	});

	it('getGlobalRateLimiter returns a singleton', () => {
		const first = getGlobalRateLimiter();
		const second = getGlobalRateLimiter();
		expect(first).toBeInstanceOf(UnifiedRateLimiter);
		expect(second).toBe(first);
	});
});
