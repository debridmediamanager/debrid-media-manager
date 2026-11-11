import Redis from 'ioredis';
import type { StartedTestContainer } from 'testcontainers';
import { GenericContainer, getContainerRuntimeClient } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SimklError } from './simkl';
import type { SimklTokens } from './simklProvider';
import type { SimklSessionStore } from './simklSession';
import {
	createRedisSimklStore,
	createSimklSessionId,
	makeSimklSession,
	renewSimklSession,
} from './simklSession';

let dockerAvailable = false;
try {
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	/* The suite requires an isolated Docker runtime. */
}

const tokens: SimklTokens = {
	access_token: 'test-old-access',
	refresh_token: 'test-refresh',
	token_type: 'Bearer',
	expires_in: 604800,
};
const user = { user: { name: 'Test' }, account: { id: 123, type: 'pro' as const } };

describe.skipIf(!dockerAvailable)('Simkl distributed Redis sessions', () => {
	let container: StartedTestContainer;
	let firstClient: Redis;
	let secondClient: Redis;
	let first: SimklSessionStore;
	let second: SimklSessionStore;
	beforeAll(async () => {
		container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
		const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
		firstClient = new Redis(url, {
			connectTimeout: 2000,
			commandTimeout: 2000,
			maxRetriesPerRequest: 1,
		});
		secondClient = new Redis(url, {
			connectTimeout: 2000,
			commandTimeout: 2000,
			maxRetriesPerRequest: 1,
		});
		firstClient.on('error', () => {});
		secondClient.on('error', () => {});
		await Promise.all([firstClient.ping(), secondClient.ping()]);
		first = createRedisSimklStore(firstClient);
		second = createRedisSimklStore(secondClient);
	}, 60_000);
	afterAll(async () => {
		firstClient?.disconnect();
		secondClient?.disconnect();
		await container?.stop();
	});
	it('refreshes once across independent replicas and forced 401 readers reuse the replacement', async () => {
		const id = createSimklSessionId();
		const original = makeSimklSession(tokens, user);
		original.expiresAt = Date.now() - 1;
		await first.create(id, original);
		const refresh = vi.fn(async () => ({ ...tokens, access_token: 'test-new-access' }));
		const results = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				renewSimklSession(id, index % 2 ? first : second, undefined, refresh)
			)
		);
		expect(refresh).toHaveBeenCalledTimes(1);
		for (const session of results) expect(session.tokens.access_token).toBe('test-new-access');
		const forced = await renewSimklSession(id, second, tokens.access_token, refresh);
		expect(forced.tokens.access_token).toBe('test-new-access');
		expect(refresh).toHaveBeenCalledTimes(1);
		await first.remove(id);
	});
	it('does not resurrect a session deleted while its refresh is in flight', async () => {
		const id = createSimklSessionId();
		const original = makeSimklSession(tokens, user);
		original.expiresAt = 0;
		await first.create(id, original);
		const started = Promise.withResolvers<void>();
		const complete = Promise.withResolvers<SimklTokens>();
		const renewing = renewSimklSession(id, first, undefined, async () => {
			started.resolve();
			return complete.promise;
		});
		await started.promise;
		await second.remove(id);
		complete.resolve({ ...tokens, access_token: 'test-new-access' });
		await expect(renewing).rejects.toMatchObject({ code: 'signed_out', status: 401 });
		expect(await first.read(id)).toBeNull();
	});
	it('refuses stale lock owners and their release cannot delete a replacement lease', async () => {
		const id = createSimklSessionId();
		const original = makeSimklSession(tokens, user);
		await first.create(id, original);
		expect(await first.acquire(id, 'old-owner')).toBe(true);
		await firstClient.del(`simkl:refresh:${id}`);
		expect(await second.acquire(id, 'new-owner')).toBe(true);
		expect(
			await first.compareAndSet(id, original, { ...original, expiresAt: 1 }, 'old-owner')
		).toBe(false);
		await first.release(id, 'old-owner');
		expect(await first.acquire(id, 'third-owner')).toBe(false);
		await second.release(id, 'new-owner');
		await first.remove(id);
	});
	it('invalid grants sign out, but transient refresh failures preserve the session', async () => {
		const id = createSimklSessionId();
		const original = makeSimklSession(tokens, user);
		original.expiresAt = 0;
		await first.create(id, original);
		await expect(
			renewSimklSession(id, first, undefined, async () => {
				throw new SimklError('upstream_unavailable', 'Unavailable', 502);
			})
		).rejects.toMatchObject({ status: 502 });
		expect(await second.read(id)).toEqual(original);
		await expect(
			renewSimklSession(id, first, undefined, async () => {
				throw new SimklError('invalid_grant', 'Revoked', 400);
			})
		).rejects.toMatchObject({ code: 'signed_out' });
		expect(await second.read(id)).toBeNull();
	});
	it('refuses malformed stored credentials before attempting refresh', async () => {
		const valid = makeSimklSession(tokens, user);
		const invalidRecords = [
			{ ...valid, tokens: { ...tokens, access_token: 123 } },
			{ ...valid, tokens: { ...tokens, refresh_token: '' } },
			{ ...valid, tokens: { ...tokens, expires_in: -1 } },
			{ ...valid, user: { ...user, account: { ...user.account, type: 'unknown' } } },
			{ ...valid, refreshExpiresAt: 'tomorrow' },
		];
		for (const record of invalidRecords) {
			const id = createSimklSessionId();
			await firstClient.set(`simkl:session:${id}`, JSON.stringify(record));
			const refresh = vi.fn(async () => tokens);
			try {
				await expect(first.read(id)).rejects.toMatchObject({
					code: 'session_unavailable',
					status: 503,
				});
				await expect(
					renewSimklSession(id, second, tokens.access_token, refresh)
				).rejects.toMatchObject({ code: 'session_unavailable', status: 503 });
				expect(refresh).not.toHaveBeenCalled();
			} finally {
				await firstClient.del(`simkl:session:${id}`);
			}
		}
	});
	it('fails closed when its Redis connection is unavailable', async () => {
		const disconnected = new Redis('redis://127.0.0.1:1', {
			lazyConnect: true,
			enableOfflineQueue: false,
			connectTimeout: 100,
			commandTimeout: 100,
			retryStrategy: () => null,
		});
		disconnected.on('error', () => {});
		try {
			await expect(
				createRedisSimklStore(disconnected).read(createSimklSessionId())
			).rejects.toMatchObject({ code: 'session_unavailable', status: 503 });
		} finally {
			disconnected.disconnect();
		}
	});
});
