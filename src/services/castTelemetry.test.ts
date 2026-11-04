import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import agents from '../test/fixtures/castTelemetry/stream-user-agents.json';

const redisState = vi.hoisted(() => ({
	calls: [] as unknown[][],
	failing: false,
	clients: 0,
}));

vi.mock('ioredis', () => ({
	default: class FakeRedis {
		constructor() {
			redisState.clients += 1;
		}
		on() {
			return this;
		}
		multi() {
			const queued: unknown[][] = [];
			const chain = {
				pfadd: (...args: unknown[]) => (queued.push(['pfadd', ...args]), chain),
				expire: (...args: unknown[]) => (queued.push(['expire', ...args]), chain),
				exec: async () => {
					if (redisState.failing) throw new Error('Connection is closed.');
					redisState.calls.push(...queued);
					return [];
				},
			};
			return chain;
		}
	},
}));

import {
	CAST_TELEMETRY_TTL_SECONDS,
	castClient,
	castTelemetryKey,
	recordCastUse,
} from './castTelemetry';

describe('castClient', () => {
	it.each(agents.agents.map((a) => [a.ua, a.client]))(
		'names the client of %j as %s',
		(ua, client) => {
			expect(castClient(ua)).toBe(client);
		}
	);

	it('reads the version a Kodi addon sends from 1.1.2 on', () => {
		expect(castClient('DMM-Kodi/1.1.2')).toBe('kodi/1.1.2');
	});

	it('names a missing header unknown', () => {
		expect(castClient(undefined)).toBe('unknown');
	});

	it('keeps a junk agent from making a long key', () => {
		expect(castClient('x'.repeat(500))).toHaveLength(24);
		expect(castClient('{"a":1}')).toBe('unknown');
	});
});

describe('recordCastUse', () => {
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	beforeEach(() => {
		vi.stubEnv('REDIS_URL', 'redis://test');
		redisState.calls = [];
		redisState.failing = false;
	});
	afterEach(() => vi.unstubAllEnvs());

	it('adds the cast id to the day, client and provider it was used with', async () => {
		const now = new Date('2026-11-05T23:59:59Z');
		recordCastUse('tb', 'ZNxmirFYKwK0', 'DMM-Kodi/1.1.2', now);
		await flush();
		const key = 'telemetry:cast:2026-11-05:kodi/1.1.2:tb';
		expect(castTelemetryKey('kodi/1.1.2', 'tb', now)).toBe(key);
		expect(redisState.calls).toEqual([
			['pfadd', key, 'ZNxmirFYKwK0'],
			['expire', key, CAST_TELEMETRY_TTL_SECONDS],
		]);
	});

	it('swallows a Redis failure and opens one connection for every call', async () => {
		redisState.failing = true;
		expect(() => recordCastUse('rd', 'abcdefghij', 'AIOStreams/2.37.0')).not.toThrow();
		recordCastUse('rd', 'abcdefghij', 'AIOStreams/2.37.0');
		await flush();
		expect(redisState.calls).toEqual([]);
		expect(redisState.clients).toBe(1);
	});

	it('records nothing without Redis', async () => {
		vi.stubEnv('REDIS_URL', '');
		recordCastUse('rd', 'abcdefghij', 'AIOStreams/2.37.0');
		await flush();
		expect(redisState.calls).toEqual([]);
	});
});
