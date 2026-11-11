import * as v from '@badrap/valita';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import type { SimklUser } from './simkl';
import { SimklError } from './simkl';
import type { SimklTokens } from './simklProvider';
import { refreshSimklToken } from './simklProvider';
import {
	simklCacheKeySchema,
	simklTimestampSchema,
	simklTokensSchema,
	simklUserSchema,
} from './simklSchemas';

export const SIMKL_SESSION_COOKIE = 'dmm_simkl_session';
export const SIMKL_SESSION_SECONDS = 180 * 24 * 60 * 60;
const LOCK_MS = 30_000;
const WAIT_MS = 15_000;
export interface SimklStoredSession {
	tokens: SimklTokens;
	expiresAt: number;
	refreshExpiresAt: number;
	cacheKey: string;
	user: SimklUser;
}

// Redis is a persistence/network boundary, not a trusted TypeScript object.
// Reject malformed credentials before any provider request or refresh runs.
const storedSessionSchema = v.object({
	tokens: simklTokensSchema,
	expiresAt: simklTimestampSchema,
	refreshExpiresAt: simklTimestampSchema,
	cacheKey: simklCacheKeySchema,
	user: simklUserSchema,
});
export interface SimklSessionStore {
	read(id: string): Promise<SimklStoredSession | null>;
	create(id: string, session: SimklStoredSession): Promise<void>;
	remove(id: string): Promise<SimklStoredSession | null>;
	acquire(id: string, owner: string): Promise<boolean>;
	release(id: string, owner: string): Promise<void>;
	compareAndSet(
		id: string,
		before: SimklStoredSession,
		after: SimklStoredSession,
		owner: string
	): Promise<boolean>;
	compareAndDelete(id: string, before: SimklStoredSession): Promise<void>;
}
const unavailable = () =>
	new SimklError('session_unavailable', 'Simkl sessions are temporarily unavailable', 503);
const signedOut = () => new SimklError('signed_out', 'Sign in to Simkl', 401);
const key = (id: string) => `simkl:session:${id}`;
const lockKey = (id: string) => `simkl:refresh:${id}`;

// Accepting an explicit Redis client lets isolated integration/smoke callers use
// the production store without introducing a public credential-import endpoint.
export function createRedisSimklStore(client: Redis): SimklSessionStore {
	const command = async <T>(work: () => Promise<T>): Promise<T> => {
		try {
			return await work();
		} catch {
			throw unavailable();
		}
	};
	const originals = new WeakMap<SimklStoredSession, string>();
	const decode = (raw: string | null): SimklStoredSession | null => {
		if (raw === null) return null;
		const session = storedSessionSchema.parse(JSON.parse(raw) as unknown);
		// CAS compares the exact persisted bytes, independent of schema output
		// ordering or object reconstruction during validation.
		originals.set(session, raw);
		return session;
	};
	return {
		read: (id) => command(async () => decode(await client.get(key(id)))),
		create: (id, session) =>
			command(async () => {
				const result = await client.set(
					key(id),
					JSON.stringify(session),
					'EX',
					SIMKL_SESSION_SECONDS,
					'NX'
				);
				if (result !== 'OK') throw unavailable();
			}),
		remove: (id) =>
			command(async () =>
				decode(
					(await client.eval(
						'local v = redis.call("get", KEYS[1]); redis.call("del", KEYS[1]); return v',
						1,
						key(id)
					)) as string | null
				)
			),
		acquire: (id, owner) =>
			command(
				async () => (await client.set(lockKey(id), owner, 'PX', LOCK_MS, 'NX')) === 'OK'
			),
		release: (id, owner) =>
			command(async () => {
				await client.eval(
					'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
					1,
					lockKey(id),
					owner
				);
			}),
		compareAndSet: (id, before, after, owner) =>
			command(
				async () =>
					Number(
						await client.eval(
							'if redis.call("get", KEYS[1]) == ARGV[1] and redis.call("get", KEYS[2]) == ARGV[4] then redis.call("set", KEYS[1], ARGV[2], "EX", ARGV[3]); return 1 else return 0 end',
							2,
							key(id),
							lockKey(id),
							originals.get(before) || JSON.stringify(before),
							JSON.stringify(after),
							SIMKL_SESSION_SECONDS,
							owner
						)
					) === 1
			),
		compareAndDelete: (id, before) =>
			command(async () => {
				await client.eval(
					'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
					1,
					key(id),
					originals.get(before) || JSON.stringify(before)
				);
			}),
	};
}
let store: SimklSessionStore | undefined;
export function getSimklSessionStore(): SimklSessionStore {
	if (store) return store;
	if (!process.env.REDIS_URL) throw unavailable();
	const client = new Redis(process.env.REDIS_URL, {
		connectTimeout: 2000,
		commandTimeout: 2000,
		maxRetriesPerRequest: 1,
	});
	client.on('error', () => {});
	store = createRedisSimklStore(client);
	return store;
}
export const createSimklSessionId = () => randomBytes(32).toString('base64url');
export function makeSimklSession(tokens: SimklTokens, user: SimklUser): SimklStoredSession {
	const now = Date.now();
	return {
		tokens,
		user,
		cacheKey: randomBytes(24).toString('base64url'),
		expiresAt: now + tokens.expires_in * 1000,
		refreshExpiresAt: now + SIMKL_SESSION_SECONDS * 1000,
	};
}
export async function requireSimklSession(
	id: string | undefined,
	sessionStore: SimklSessionStore
): Promise<SimklStoredSession> {
	if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw signedOut();
	const session = await sessionStore.read(id);
	if (!session || session.refreshExpiresAt <= Date.now()) throw signedOut();
	return session;
}
export async function renewSimklSession(
	id: string,
	sessionStore: SimklSessionStore,
	observedAccessToken?: string,
	refresh: (token: string) => Promise<SimklTokens> = refreshSimklToken
): Promise<SimklStoredSession> {
	const started = Date.now();
	const owner = randomBytes(16).toString('hex');
	while (!(await sessionStore.acquire(id, owner))) {
		if (Date.now() - started >= WAIT_MS) throw unavailable();
		const delay = Promise.withResolvers<void>();
		setTimeout(delay.resolve, 50);
		await delay.promise;
	}
	try {
		const current = await requireSimklSession(id, sessionStore);
		// A forced 401 retry observes a specific access token. If another replica
		// replaced it while we waited, reuse its result rather than revoking it.
		if (
			observedAccessToken !== undefined
				? current.tokens.access_token !== observedAccessToken
				: current.expiresAt > Date.now() + 24 * 60 * 60 * 1000
		)
			return current;
		if (!current.tokens.refresh_token) {
			await sessionStore.compareAndDelete(id, current);
			throw signedOut();
		}
		let tokens: SimklTokens;
		try {
			tokens = await refresh(current.tokens.refresh_token);
		} catch (error) {
			if (
				error instanceof SimklError &&
				(error.isUnauthorized || error.code === 'invalid_grant')
			) {
				await sessionStore.compareAndDelete(id, current);
				throw signedOut();
			}
			throw error;
		}
		const next: SimklStoredSession = {
			...current,
			tokens: {
				...tokens,
				refresh_token: tokens.refresh_token || current.tokens.refresh_token,
			},
			expiresAt: Date.now() + tokens.expires_in * 1000,
			refreshExpiresAt: Date.now() + SIMKL_SESSION_SECONDS * 1000,
		};
		if (!(await sessionStore.compareAndSet(id, current, next, owner))) {
			const latest = await requireSimklSession(id, sessionStore);
			if (latest.tokens.access_token === current.tokens.access_token) throw unavailable();
			return latest;
		}
		return next;
	} finally {
		// A failed release is safe: the bounded lease expires. It must not hide
		// the primary result or make a successful refresh look like a failure.
		await sessionStore.release(id, owner).catch(() => {});
	}
}
export async function withSimklSession<T>(
	id: string | undefined,
	sessionStore: SimklSessionStore,
	work: (session: SimklStoredSession) => Promise<T>
): Promise<T> {
	let session = await requireSimklSession(id, sessionStore);
	if (session.expiresAt <= Date.now() + 24 * 60 * 60 * 1000)
		session = await renewSimklSession(id!, sessionStore);
	try {
		return await work(session);
	} catch (error) {
		if (!(error instanceof SimklError) || !error.isUnauthorized) throw error;
		session = await renewSimklSession(id!, sessionStore, session.tokens.access_token);
		try {
			return await work(session);
		} catch (retryError) {
			if (retryError instanceof SimklError && retryError.isUnauthorized) {
				await sessionStore.compareAndDelete(id!, session);
				throw signedOut();
			}
			throw retryError;
		}
	}
}
