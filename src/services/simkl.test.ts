import { describe, expect, it, vi } from 'vitest';
import invalidGrant400 from '../test/fixtures/simkl/invalid-grant-400.json';
import listItems200 from '../test/fixtures/simkl/list-items-200.json';
import premiumOnly200 from '../test/fixtures/simkl/premium-only-200.json';
import privateList403 from '../test/fixtures/simkl/private-list-403.json';
import token200 from '../test/fixtures/simkl/token-200.json';
import userLists200 from '../test/fixtures/simkl/user-lists-200.json';
import userSettings200 from '../test/fixtures/simkl/user-settings-200.json';
import userTokenRequired401 from '../test/fixtures/simkl/user-token-required-401.json';

// `vi.mock` is hoisted above every `const` in this file, so the id the factory
// closes over has to be hoisted with it.
const { CLIENT_ID } = vi.hoisted(() => ({ CLIENT_ID: 'test-client-id' }));

vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { simklClientId: CLIENT_ID } }),
}));

import {
	SIMKL_AUTHORIZE_URL,
	SimklError,
	_testing,
	buildSimklAuthorizeUrl,
	createCodeVerifier,
	deriveCodeChallenge,
	exchangeSimklCode,
	getSimklList,
	getSimklUser,
	getSimklUserLists,
	refreshSimklToken,
	simklItemHref,
} from './simkl';

/** One canned response, as `fetch` would hand it back. */
const respond = (body: unknown, status = 200) =>
	vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		text: async () => JSON.stringify(body),
	}) as unknown as typeof fetch;

/** A different response per call, in order. */
const respondInOrder = (...pages: { body: unknown; status?: number }[]) => {
	const fetcher = vi.fn();
	pages.forEach(({ body, status = 200 }) =>
		fetcher.mockResolvedValueOnce({
			ok: status >= 200 && status < 300,
			status,
			text: async () => JSON.stringify(body),
		})
	);
	return fetcher as unknown as typeof fetch;
};

const calls = (fetcher: typeof fetch) =>
	(fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls;

describe('PKCE', () => {
	it('derives the S256 challenge RFC 7636 specifies', async () => {
		// The worked example from RFC 7636 appendix B. Simkl accepts S256 only,
		// so a wrong encoding here is an invalid_grant on every single login.
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		expect(await deriveCodeChallenge(verifier)).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		);
	});

	it('mints a verifier inside the 43-128 character range, unpadded', () => {
		const verifier = createCodeVerifier();
		expect(verifier).toHaveLength(43);
		expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
		expect(createCodeVerifier()).not.toBe(verifier);
	});
});

describe('buildSimklAuthorizeUrl', () => {
	it('carries every parameter Simkl requires', () => {
		const url = new URL(
			buildSimklAuthorizeUrl({
				clientId: CLIENT_ID,
				redirectUri: 'https://debridmediamanager.com/auth/simkl',
				codeChallenge: 'challenge',
				state: 'state-value',
			})
		);

		expect(`${url.origin}${url.pathname}`).toBe(SIMKL_AUTHORIZE_URL);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			response_type: 'code',
			client_id: CLIENT_ID,
			redirect_uri: 'https://debridmediamanager.com/auth/simkl',
			code_challenge: 'challenge',
			// S256 is mandatory under V2; plain is not accepted at all.
			code_challenge_method: 'S256',
			state: 'state-value',
			scope: 'media:read',
		});
	});
});

describe('token exchange', () => {
	it('posts the PKCE verifier form-encoded and without a client secret', async () => {
		const fetcher = respond(token200);
		const tokens = await exchangeSimklCode(
			{
				code: 'auth-code',
				codeVerifier: 'verifier',
				redirectUri: 'https://debridmediamanager.com/auth/simkl',
			},
			fetcher
		);

		const [url, init] = calls(fetcher)[0];
		expect(url).toBe('https://api.simkl.com/oauth2/token');
		expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

		const body = Object.fromEntries(new URLSearchParams(init.body));
		expect(body).toEqual({
			grant_type: 'authorization_code',
			code: 'auth-code',
			redirect_uri: 'https://debridmediamanager.com/auth/simkl',
			code_verifier: 'verifier',
			client_id: CLIENT_ID,
		});
		// The registered client is public. A secret in browser code would be
		// published, which is the whole reason PKCE is mandatory here.
		expect(init.body).not.toContain('client_secret');
		expect(tokens.access_token).toBe(token200.access_token);
	});

	it('sends the refresh grant with the stored refresh token', async () => {
		const fetcher = respond(token200);
		await refreshSimklToken('refresh-token', fetcher);

		const body = Object.fromEntries(new URLSearchParams(calls(fetcher)[0][1].body));
		expect(body).toEqual({
			grant_type: 'refresh_token',
			refresh_token: 'refresh-token',
			client_id: CLIENT_ID,
		});
	});

	it('reports a spent or expired code as the error Simkl named', async () => {
		const fetcher = respond(invalidGrant400, 400);
		await expect(refreshSimklToken('stale', fetcher)).rejects.toMatchObject({
			name: 'SimklError',
			code: 'invalid_grant',
		});
	});
});

describe('request shape', () => {
	it('identifies the app on every call and sends the bearer token', async () => {
		const fetcher = respond(userSettings200);
		await getSimklUser('access-token', fetcher);

		const [url, init] = calls(fetcher)[0];
		const params = new URL(url).searchParams;
		expect(new URL(url).pathname).toBe('/users/settings');
		expect(params.get('client_id')).toBe(CLIENT_ID);
		expect(params.get('app-name')).toBe(_testing.APP_NAME);
		expect(params.get('app-version')).toBe(_testing.APP_VERSION);
		expect(init.headers.Authorization).toBe('Bearer access-token');
		// A Content-Type on a GET turns a preflight-once call into a
		// preflighted one for a body that does not exist.
		expect(init.headers['Content-Type']).toBeUndefined();
	});

	it('never sets User-Agent, which a browser forbids', async () => {
		const fetcher = respond(userSettings200);
		await getSimklUser('access-token', fetcher);
		const headers = calls(fetcher)[0][1].headers;
		expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('user-agent');
	});
});

describe('refusals', () => {
	it('treats the premium_only body as a refusal even though it arrives with HTTP 200', async () => {
		// The trap this whole client is shaped around. Simkl serves a free
		// account an HTTP 200 whose singular `item` is a renderable
		// "Upgrade to Simkl PRO/VIP" placeholder with a real poster URL, and no
		// `items` array at all. Branching on the status code renders that
		// placeholder as a title the user supposedly added.
		const fetcher = respond(premiumOnly200, 200);
		const failure = await getSimklList('token', 216324, fetcher).catch((e) => e);

		expect(failure).toBeInstanceOf(SimklError);
		expect(failure.isPremiumOnly).toBe(true);
		expect(failure.message).toContain('PRO and VIP');
	});

	it('reports a V2 client id used without a token as unauthorized', async () => {
		// Captured from production: V2 withdrew the anonymous access the Custom
		// Lists guide still describes, so this is what the endpoint answers
		// before any premium check runs.
		const fetcher = respond(userTokenRequired401, 401);
		const failure = await getSimklUserLists('', 5, fetcher).catch((e) => e);

		expect(failure).toBeInstanceOf(SimklError);
		expect(failure.code).toBe('user_token_required');
		expect(failure.isUnauthorized).toBe(true);
		expect(failure.isPremiumOnly).toBe(false);
	});

	it('carries a private list refusal through as its own code', async () => {
		const fetcher = respond(privateList403, 403);
		const failure = await getSimklList('token', 216324, fetcher).catch((e) => e);
		expect(failure.code).toBe('private_list');
		expect(failure.status).toBe(403);
	});

	it('does not throw a SyntaxError when Simkl answers with HTML', async () => {
		const fetcher = vi.fn().mockResolvedValue({
			ok: false,
			status: 502,
			text: async () => '<html>Bad gateway</html>',
		}) as unknown as typeof fetch;
		const failure = await getSimklUser('token', fetcher).catch((e) => e);
		expect(failure).toBeInstanceOf(SimklError);
		expect(failure.code).toBe('non_json_response');
		expect(failure.status).toBe(502);
	});
});

describe('getSimklUserLists', () => {
	it('returns every list on a single page', async () => {
		const fetcher = respond(userLists200);
		const lists = await getSimklUserLists('token', 8199460, fetcher);

		expect(lists.map((l) => l.id)).toEqual([216282, 76609]);
		expect(new URL(calls(fetcher)[0][0]).pathname).toBe('/lists/user/8199460');
		expect(new URL(calls(fetcher)[0][0]).searchParams.get('limit')).toBe(
			String(_testing.PAGE_SIZE)
		);
	});

	it('walks every page the pagination block announces', async () => {
		const page = (lists: unknown[], total_pages: number) => ({
			body: { pagination: { page: 1, limit: 500, total_items: 0, total_pages }, lists },
		});
		const full = Array.from({ length: _testing.PAGE_SIZE }, (_, i) => ({
			id: i,
			name: `l${i}`,
		}));
		const fetcher = respondInOrder(page(full, 2), page([{ id: 999, name: 'last' }], 2));

		const lists = await getSimklUserLists('token', 1, fetcher);

		expect(lists).toHaveLength(_testing.PAGE_SIZE + 1);
		expect(new URL(calls(fetcher)[1][0]).searchParams.get('page')).toBe('2');
	});

	it('stops at Simkl’s page-times-limit ceiling rather than paging forever', async () => {
		// `page * limit` may not exceed 10000, and Simkl clamps silently instead
		// of erroring - a client that trusts `total_pages` requests pages that
		// can only come back as duplicates of the last reachable one.
		const full = Array.from({ length: _testing.PAGE_SIZE }, (_, i) => ({ id: i }));
		const fetcher = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({
					pagination: { page: 1, limit: 500, total_items: 1e6, total_pages: 1000 },
					lists: full,
				}),
		}) as unknown as typeof fetch;

		const lists = await getSimklUserLists('token', 1, fetcher);

		expect(lists).toHaveLength(_testing.MAX_WINDOW);
		expect(calls(fetcher)).toHaveLength(_testing.MAX_WINDOW / _testing.PAGE_SIZE);
	});
});

describe('getSimklList', () => {
	it('returns the list metadata alongside its items', async () => {
		const fetcher = respond(listItems200);
		const list = await getSimklList('token', 216324, fetcher);

		expect(list.name).toBe('Unlisted TV list');
		expect(list.privacy).toBe('unlisted');
		expect(list.items).toHaveLength(1);
		expect(list.items[0].ids.imdb).toBe('tt4574334');
		// The paging block is an artifact of how the items were fetched, not
		// part of the list.
		expect((list as unknown as Record<string, unknown>).pagination).toBeUndefined();
	});
});

describe('simklItemHref', () => {
	it('routes a movie and a series to their DMM pages', () => {
		expect(
			simklItemHref({
				title: 'Ghost in the Shell',
				type: 'movie',
				ids: { simkl_id: 1, imdb: 'tt0113568' },
			})
		).toBe('/movie/tt0113568');
		expect(
			simklItemHref({
				title: 'Stranger Things',
				type: 'tv',
				ids: { simkl_id: 2, imdb: 'tt4574334' },
			})
		).toBe('/show/tt4574334');
	});

	it('files anime under /show, which is where DMM keeps everything episodic', () => {
		expect(
			simklItemHref({
				title: 'Monster',
				type: 'anime',
				ids: { simkl_id: 3, imdb: 'tt0413573' },
			})
		).toBe('/show/tt0413573');
	});

	it('returns null when Simkl carries no usable IMDb id', () => {
		expect(simklItemHref({ title: 'x', type: 'movie', ids: { simkl_id: 4 } })).toBeNull();
		expect(
			simklItemHref({ title: 'x', type: 'movie', ids: { simkl_id: 5, imdb: 'not-an-id' } })
		).toBeNull();
	});
});
