import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import premiumOnly200 from '../test/fixtures/simkl/premium-only-200.json';
import token200 from '../test/fixtures/simkl/token-200.json';
import userSettings200 from '../test/fixtures/simkl/user-settings-200.json';
import userTokenRequired401 from '../test/fixtures/simkl/user-token-required-401.json';
import type { SimklProxyRequest } from './simklProxy';
import { handleSimklRequest } from './simklProxy';
import type { SimklSessionStore, SimklStoredSession } from './simklSession';
import { createSimklSessionId, makeSimklSession, SIMKL_SESSION_COOKIE } from './simklSession';

const origin = 'https://debridmediamanager.com';
const sessionUser = {
	user: { name: userSettings200.user.name },
	account: { id: userSettings200.account.id, type: 'free' as const },
};
function request(route: string[], method = 'GET', body?: unknown): SimklProxyRequest {
	return {
		route,
		method,
		body,
		headers: { origin, host: 'debridmediamanager.com' },
		env: { NODE_ENV: 'production' },
	};
}
function memoryStore(): SimklSessionStore {
	const values = new Map<string, SimklStoredSession>();
	const locks = new Map<string, string>();
	return {
		read: async (id) => values.get(id) || null,
		create: async (id, value) => {
			values.set(id, value);
		},
		remove: async (id) => {
			const value = values.get(id) || null;
			values.delete(id);
			return value;
		},
		acquire: async (id, owner) => {
			if (locks.has(id)) return false;
			locks.set(id, owner);
			return true;
		},
		release: async (id, owner) => {
			if (locks.get(id) === owner) locks.delete(id);
		},
		compareAndSet: async (id, before, after, owner) => {
			if (values.get(id) !== before || locks.get(id) !== owner) return false;
			values.set(id, after);
			return true;
		},
		compareAndDelete: async (id, before) => {
			if (values.get(id) === before) values.delete(id);
		},
	};
}
function responses(...bodies: { body: unknown; status?: number }[]) {
	const fetcher = vi.fn();
	for (const { body, status = 200 } of bodies)
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
	vi.stubGlobal('fetch', fetcher);
	return fetcher;
}
beforeEach(() => {
	vi.stubEnv('REDIS_URL', '');
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('Simkl cookie API security boundaries', () => {
	it('refuses arbitrary routes, invalid ids, and incorrect methods before contacting upstream', async () => {
		for (const [route, method, status] of [
			[['proxy', 'users'], 'GET', 404],
			[['list', '0'], 'GET', 404],
			[['account', 'extra'], 'GET', 404],
			[['logout'], 'GET', 405],
			[['exchange'], 'GET', 405],
			[['lists'], 'POST', 405],
		] as [string[], string, number][]) {
			const result = await handleSimklRequest(request(route, method));
			expect(result.httpStatus).toBe(status);
			expect(result.headers['Cache-Control']).toBe('private, no-store');
		}
	});
	it('refuses cross-site mutations even when an attacker supplies its own Host and Origin', async () => {
		const req = request(['logout'], 'POST');
		req.headers.origin = 'https://attacker.example';
		req.headers.host = 'attacker.example';
		expect((await handleSimklRequest(req, memoryStore())).httpStatus).toBe(403);
		delete req.headers.origin;
		expect((await handleSimklRequest(req, memoryStore())).httpStatus).toBe(403);
		req.headers.origin = origin;
		req.headers['sec-fetch-site'] = 'cross-site';
		expect((await handleSimklRequest(req, memoryStore())).httpStatus).toBe(403);
	});
	it('refuses an unregistered redirect and caller-controlled client id', async () => {
		const body = {
			code: 'test-code',
			codeVerifier: 'v'.repeat(43),
			redirectUri: 'https://attacker.example/auth/simkl',
		};
		expect(
			(await handleSimklRequest(request(['exchange'], 'POST', body), memoryStore()))
				.httpStatus
		).toBe(400);
		body.redirectUri = origin + '/auth/simkl';
		expect(
			(
				await handleSimklRequest(
					request(['exchange'], 'POST', { ...body, client_id: 'attacker' }),
					memoryStore()
				)
			).httpStatus
		).toBe(400);
	});
	it('fails closed without Redis rather than treating an outage as signed out', async () => {
		const result = await handleSimklRequest(request(['account']));
		expect(result.httpStatus).toBe(503);
		expect(result.body).toMatchObject({ error: 'session_unavailable', status: 503 });
	});
	it('signed-out account reads return a private 401', async () => {
		const result = await handleSimklRequest(request(['account']), memoryStore());
		expect(result.httpStatus).toBe(401);
		expect(result.body).toMatchObject({ error: 'signed_out', status: 401 });
	});
	it('exchanges into an opaque protected cookie and whitelists account fields', async () => {
		const store = memoryStore();
		const profile = {
			...userSettings200,
			access_token: 'should-not-leak',
			user: { ...userSettings200.user, refresh_token: 'should-not-leak' },
			account: { ...userSettings200.account, secret: 'should-not-leak' },
		};
		responses({ body: token200 }, { body: profile }, { body: profile });
		const exchange = await handleSimklRequest(
			request(['exchange'], 'POST', {
				code: 'test-code',
				codeVerifier: 'v'.repeat(43),
				redirectUri: origin + '/auth/simkl',
			}),
			store
		);
		expect(exchange.httpStatus).toBe(200);
		expect(exchange.body).toEqual({ ok: true });
		const cookie = exchange.headers['Set-Cookie'];
		expect(cookie).toMatch(
			/^dmm_simkl_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=15552000; Secure$/
		);
		const req = request(['account']);
		req.headers.cookie = cookie.split(';')[0];
		const account = await handleSimklRequest(req, store);
		expect(account.httpStatus).toBe(200);
		expect(account.body).toMatchObject({
			user: sessionUser,
			cacheKey: expect.any(String),
			expiresAt: expect.any(Number),
		});
		expect(JSON.stringify(account.body)).not.toContain('should-not-leak');
		expect(JSON.stringify(account.body)).not.toContain(token200.access_token);
		expect(JSON.stringify(account.body)).not.toContain(cookie.split('=')[1].split(';')[0]);
	});
	it('returns the HTTP 200 premium refusal as an error, not an upgrade item list', async () => {
		const store = memoryStore();
		const id = createSimklSessionId();
		await store.create(id, makeSimklSession(token200, sessionUser));
		responses({ body: premiumOnly200 });
		const req = request(['list', '216324']);
		req.headers.cookie = `${SIMKL_SESSION_COOKIE}=${id}`;
		const result = await handleSimklRequest(req, store);
		expect(result.httpStatus).toBe(400);
		expect(result.body).toMatchObject({ error: 'premium_only', status: 400 });
	});
	it('retries an unauthorized read after refreshing on the server without returning credentials', async () => {
		const store = memoryStore();
		const id = createSimklSessionId();
		await store.create(id, makeSimklSession(token200, sessionUser));
		responses(
			{ body: userTokenRequired401, status: 401 },
			{ body: { ...token200, access_token: 'test-replacement' } },
			{ body: userSettings200 }
		);
		const req = request(['account']);
		req.headers.cookie = `${SIMKL_SESSION_COOKIE}=${id}`;
		const result = await handleSimklRequest(req, store);
		expect(result.httpStatus).toBe(200);
		expect((await store.read(id))?.tokens.access_token).toBe('test-replacement');
		expect(JSON.stringify(result.body)).not.toContain('test-replacement');
	});
	it('deletes local state and clears the cookie even when grant revocation fails', async () => {
		const store = memoryStore();
		const id = createSimklSessionId();
		await store.create(id, makeSimklSession(token200, sessionUser));
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new Error('credential-bearing exception'))
		);
		const req = request(['logout'], 'POST');
		req.headers.cookie = `${SIMKL_SESSION_COOKIE}=${id}`;
		const result = await handleSimklRequest(req, store);
		expect(result.httpStatus).toBe(200);
		expect(result.body).toEqual({ ok: true });
		expect(result.headers['Set-Cookie']).toContain('Max-Age=0');
		expect(await store.read(id)).toBeNull();
	});
	it('does not expose an unknown credential-like provider error code', async () => {
		const store = memoryStore();
		const id = createSimklSessionId();
		await store.create(id, makeSimklSession(token200, sessionUser));
		const opaqueProviderCode = 'a'.repeat(64);
		responses({
			body: { error: opaqueProviderCode, message: token200.refresh_token },
			status: 502,
		});
		const req = request(['list', '216324']);
		req.headers.cookie = `${SIMKL_SESSION_COOKIE}=${id}`;

		const result = await handleSimklRequest(req, store);

		expect(result.httpStatus).toBe(502);
		expect(result.body).toMatchObject({ error: 'upstream_error', status: 502 });
		expect(JSON.stringify(result.body)).not.toContain(opaqueProviderCode);
		expect(JSON.stringify(result.body)).not.toContain(token200.refresh_token);
	});
});
