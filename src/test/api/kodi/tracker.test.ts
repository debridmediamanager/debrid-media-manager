// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import poll from '@/pages/api/kodi/tracker/poll';
import refresh from '@/pages/api/kodi/tracker/refresh';
import start from '@/pages/api/kodi/tracker/start';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

// Tracker answers, recorded or from the tracker's docs (see the README there). Replacing
// a file with a live capture is all it takes to drive these tests from the real thing.
const FIXTURES = path.join(__dirname, '../../fixtures/kodi-trackers');
const fixture = (name: string): { status: number; body: unknown } =>
	JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
const reply = (name: string) => {
	const { status, body } = fixture(name);
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
};
const bare = (status: number) => new Response('', { status });

const ENV = {
	TRAKT_CLIENT_ID: 'trakt-client-id-0123456789',
	TRAKT_CLIENT_SECRET: 'trakt-client-secret-do-not-leak',
	// DMM's public AUTH V2 Simkl app, which has no secret.
	SIMKL_V2_CLIENT_ID: 'ee604693523d56749368fc703b2467b60a2ee2531af258f689c8b9666a5d3c5b',
	// The anime lookup's V1 key, which cannot run a device flow and must not be used for one.
	SIMKL_CLIENT_ID: 'simkl-v1-client-id-not-for-linking',
};
const SECRETS = [ENV.TRAKT_CLIENT_SECRET];

const fetchMock = vi.fn();
const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

async function call(handler: typeof start, body?: unknown, method = 'POST') {
	const res = createMockResponse();
	await handler(createMockRequest({ method, body, url: '/api/kodi/tracker' }), res);
	return { status: res._getStatusCode(), json: res._getData() as any, res };
}

/** The n-th request DMM sent: URL, headers, and the body as an object (JSON or form). */
function sent(n = 0) {
	const [url, init] = fetchMock.mock.calls[n];
	const body =
		init.body instanceof URLSearchParams
			? Object.fromEntries(init.body)
			: init.body
				? JSON.parse(init.body)
				: undefined;
	return { url: new URL(url), method: init.method, headers: init.headers, body };
}

const SERVICES = {
	trakt: {
		start: 'trakt-device-code',
		userCode: 'RNYZXKVU',
		env: ['TRAKT_CLIENT_ID', 'TRAKT_CLIENT_SECRET'],
		clientId: ENV.TRAKT_CLIENT_ID,
		// The code rides in the path of the activate page Trakt names (auth.trakt.tv since 2026).
		verifyUrl: 'https://auth.trakt.tv/activate/RNYZXKVU',
		pending: ['trakt-device-token-pending', 'trakt-device-token-slow-down'],
		expired: [
			() => reply('trakt-device-token-unknown'),
			() => reply('trakt-device-token-expired'),
			() => bare(409), // already used: documented, needs a real approval to capture
			() => bare(418), // denied: documented, needs a real denial to capture
		],
		approved: 'trakt-device-token-approved',
		settings: 'trakt-users-settings',
		user: { name: 'yowmamasita', slug: 'yowmamasita' },
		refreshed: 'trakt-refresh-ok',
		relink: 'trakt-refresh-invalid-grant',
		invalidClient: 'trakt-device-code-invalid-client',
	},
	simkl: {
		start: 'simkl-device',
		env: ['SIMKL_V2_CLIENT_ID'],
		clientId: ENV.SIMKL_V2_CLIENT_ID,
		userCode: 'E80A-7Q5A',
		verifyUrl: 'https://simkl.com/pin?user_code=E80A-7Q5A',
		pending: ['simkl-token-pending', 'simkl-token-slow-down'],
		expired: [() => reply('simkl-token-expired')],
		approved: 'simkl-token-approved',
		settings: 'simkl-users-settings',
		user: { name: 'Ben Adrian Sarmiento', slug: '7610773' },
		refreshed: 'simkl-refresh-ok',
		relink: 'simkl-refresh-invalid-grant',
		invalidClient: 'simkl-invalid-client',
	},
} as const;

beforeEach(() => {
	fetchMock.mockReset();
	errorLog.mockClear();
	vi.stubGlobal('fetch', fetchMock);
	for (const [variable, value] of Object.entries(ENV)) vi.stubEnv(variable, value);
	vi.useFakeTimers({ now: new Date('2026-11-09T12:00:00Z'), toFake: ['Date'] });
});

afterEach(() => {
	// Whatever a test did, no secret reached a log line.
	for (const secret of SECRETS) expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe.each(Object.keys(SERVICES) as (keyof typeof SERVICES)[])('%s', (service) => {
	const t = SERVICES[service];
	const name = service === 'trakt' ? 'Trakt' : 'Simkl';

	it('starts a link with the code the tracker shows and its approve page', async () => {
		fetchMock.mockResolvedValueOnce(reply(t.start));
		const { status, json, res } = await call(start, { service });
		const device = fixture(t.start).body as any;

		expect(status).toBe(200);
		expect(json).toEqual({
			service,
			userCode: t.userCode,
			deviceCode: device.device_code,
			verifyUrl: t.verifyUrl,
			interval: device.interval,
			expiresIn: device.expires_in,
		});
		expect(json.verifyUrl).not.toContain(device.device_code);
		expect(res._getHeaders()['Cache-Control']).toBe('no-store');

		const request = sent();
		expect(request.method).toBe('POST');
		expect(request.headers['User-Agent']).toBe('debridmediamanager/1.0');
		// Starting needs no secret, so none is sent.
		expect(JSON.stringify(request.body)).not.toContain(ENV.TRAKT_CLIENT_SECRET);
		if (service === 'trakt') {
			expect(request.url.href).toBe('https://api.trakt.tv/oauth/device/code');
			expect(request.headers).toMatchObject({
				'trakt-api-version': '2',
				'trakt-api-key': ENV.TRAKT_CLIENT_ID,
			});
			expect(request.body).toEqual({ client_id: ENV.TRAKT_CLIENT_ID });
		} else {
			expect(request.url.origin + request.url.pathname).toBe(
				'https://api.simkl.com/oauth2/device'
			);
			expect(Object.fromEntries(request.url.searchParams)).toEqual({
				client_id: ENV.SIMKL_V2_CLIENT_ID,
				'app-name': 'debridmediamanager',
				'app-version': '1.0',
			});
			expect(request.body).toEqual({
				client_id: ENV.SIMKL_V2_CLIENT_ID,
				scope: 'media:read',
			});
		}
	});

	it.each(t.env)('says linking is not set up without %s, on every route', async (variable) => {
		vi.stubEnv(variable, undefined);
		const expected = { error: `${name} linking is not set up on this DMM` };
		for (const [handler, body] of [
			[start, { service }],
			[poll, { service, deviceCode: 'device-code-123' }],
			[refresh, { service, refreshToken: 'refresh-token-123' }],
		] as const) {
			const { status, json } = await call(handler, body);
			expect(status).toBe(503);
			expect(json).toEqual(expected);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('answers 503 when the tracker is down, unreachable or refuses DMM', async () => {
		const unreachable = { error: `Could not reach ${name} right now. Try again in a minute.` };
		const failures = [
			() => bare(502),
			() => Promise.reject(new TypeError('fetch failed')),
			() => reply(t.invalidClient),
		];
		for (const failure of failures) {
			for (const [handler, body] of [
				[start, { service }],
				[poll, { service, deviceCode: 'device-code-123' }],
				[refresh, { service, refreshToken: 'refresh-token-123' }],
			] as const) {
				fetchMock.mockImplementationOnce(failure);
				const { status, json } = await call(handler, body);
				expect(status).toBe(503);
				expect(json).toEqual(unreachable);
			}
		}
	});

	it.each(t.pending)('keeps Kodi waiting on %s', async (name) => {
		fetchMock.mockResolvedValueOnce(reply(name));
		const { status, json } = await call(poll, { service, deviceCode: 'device-code-123' });
		expect(status).toBe(202);
		expect(json).toEqual({ status: 'pending' });

		const request = sent();
		if (service === 'trakt') {
			expect(request.url.href).toBe('https://api.trakt.tv/oauth/device/token');
			expect(request.body).toEqual({
				code: 'device-code-123',
				client_id: ENV.TRAKT_CLIENT_ID,
				client_secret: ENV.TRAKT_CLIENT_SECRET,
			});
		} else {
			expect(request.url.pathname).toBe('/oauth2/token');
			expect(request.body).toEqual({
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				client_id: ENV.SIMKL_V2_CLIENT_ID,
				device_code: 'device-code-123',
			});
		}
	});

	it('tells Kodi a dead code is expired', async () => {
		for (const answer of t.expired) {
			fetchMock.mockImplementationOnce(answer);
			const { status, json } = await call(poll, { service, deviceCode: 'device-code-123' });
			expect(status).toBe(410);
			expect(json).toEqual({ status: 'expired' });
		}
	});

	it('hands Kodi the tokens and who approved', async () => {
		fetchMock.mockResolvedValueOnce(reply(t.approved)).mockResolvedValueOnce(reply(t.settings));
		const { status, json, res } = await call(poll, { service, deviceCode: 'device-code-123' });
		const tokens = fixture(t.approved).body as any;

		expect(status).toBe(200);
		expect(json).toEqual({
			status: 'linked',
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
			clientId: t.clientId,
			user: t.user,
		});
		expect(json.expiresAt).toBe('2026-11-16T12:00:00.000Z');
		expect(res._getHeaders()['Cache-Control']).toBe('no-store');

		const profile = sent(1);
		expect(profile.method).toBe('GET');
		expect(profile.url.pathname).toBe('/users/settings');
		expect(profile.headers.Authorization).toBe(`Bearer ${tokens.access_token}`);
		expect(profile.headers['User-Agent']).toBe('debridmediamanager/1.0');
		if (service === 'simkl') {
			expect(profile.url.searchParams.get('client_id')).toBe(ENV.SIMKL_V2_CLIENT_ID);
			expect(profile.url.searchParams.get('app-name')).toBe('debridmediamanager');
			expect(profile.url.searchParams.get('app-version')).toBe('1.0');
		} else {
			expect(profile.headers['trakt-api-key']).toBe(ENV.TRAKT_CLIENT_ID);
		}
	});

	it('still links when the profile cannot be read', async () => {
		for (const failure of [() => bare(500), () => Promise.reject(new Error('reset'))]) {
			fetchMock.mockResolvedValueOnce(reply(t.approved)).mockImplementationOnce(failure);
			const { status, json } = await call(poll, { service, deviceCode: 'device-code-123' });
			expect(status).toBe(200);
			expect(json.status).toBe('linked');
			expect(json.user).toBeNull();
		}
	});

	it('refreshes with what the tracker returns', async () => {
		fetchMock.mockResolvedValueOnce(reply(t.refreshed));
		const { status, json } = await call(refresh, {
			service,
			refreshToken: 'refresh-token-123',
		});
		const tokens = fixture(t.refreshed).body as any;

		expect(status).toBe(200);
		expect(json).toEqual({
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: '2026-11-16T12:00:00.000Z',
		});
		const request = sent();
		if (service === 'trakt') {
			expect(request.url.href).toBe('https://api.trakt.tv/oauth/token');
			expect(request.body).toEqual({
				refresh_token: 'refresh-token-123',
				client_id: ENV.TRAKT_CLIENT_ID,
				client_secret: ENV.TRAKT_CLIENT_SECRET,
				redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
				grant_type: 'refresh_token',
			});
		} else {
			expect(request.url.pathname).toBe('/oauth2/token');
			expect(request.body).toEqual({
				grant_type: 'refresh_token',
				client_id: ENV.SIMKL_V2_CLIENT_ID,
				refresh_token: 'refresh-token-123',
			});
		}
	});

	it('asks Kodi to link again when the tracker refuses the grant', async () => {
		fetchMock.mockResolvedValueOnce(reply(t.relink));
		const { status, json } = await call(refresh, {
			service,
			refreshToken: 'refresh-token-123',
		});
		expect(status).toBe(401);
		expect(json).toEqual({ error: 'relink' });
	});
});

it('reads a Trakt 401 refusal as a dead grant too', async () => {
	fetchMock.mockResolvedValueOnce(
		new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401 })
	);
	const { status } = await call(refresh, { service: 'trakt', refreshToken: 'refresh-token-123' });
	expect(status).toBe(401);
});

it('refuses wrong methods and malformed bodies before calling a tracker', async () => {
	for (const handler of [start, poll, refresh]) {
		const { status, res } = await call(handler, { service: 'trakt' }, 'GET');
		expect(status).toBe(405);
		expect(res._getHeaders().Allow).toBe('POST');
	}
	for (const body of [undefined, {}, { service: 'letterboxd' }, { service: 7 }]) {
		expect((await call(start, body)).status).toBe(400);
	}
	for (const deviceCode of [undefined, 42, '', 'short', 'has a space in it', 'x'.repeat(2049)]) {
		expect((await call(poll, { service: 'simkl', deviceCode })).status).toBe(400);
	}
	expect((await call(poll, { service: 'nope', deviceCode: 'device-code-123' })).status).toBe(400);
	for (const refreshToken of [undefined, ['refresh-token-123'], 'tab\tinside-token']) {
		expect((await call(refresh, { service: 'trakt', refreshToken })).status).toBe(400);
	}
	expect(fetchMock).not.toHaveBeenCalled();
});

it('never puts a client secret in a response or a log line', async () => {
	const failures = [
		() => bare(500),
		() => Promise.reject(new TypeError('fetch failed')),
		() => reply('trakt-device-code-invalid-client'),
		() => new Response('<html>Bad gateway</html>', { status: 200 }),
	];
	for (const service of ['trakt', 'simkl']) {
		for (const failure of failures) {
			for (const [handler, body] of [
				[start, { service }],
				[poll, { service, deviceCode: 'device-code-123' }],
				[refresh, { service, refreshToken: 'refresh-token-123' }],
			] as const) {
				fetchMock.mockImplementationOnce(failure);
				const { json } = await call(handler, body);
				for (const secret of SECRETS) expect(JSON.stringify(json)).not.toContain(secret);
			}
		}
	}
	expect(errorLog).toHaveBeenCalled();
	for (const secret of SECRETS) expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
});
