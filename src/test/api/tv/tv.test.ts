import { beforeEach, describe, expect, it, vi } from 'vitest';

import approve from '@/pages/api/tv/approve';
import pair from '@/pages/api/tv/pair';
import poll from '@/pages/api/tv/poll';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { MAX_STATE_BYTES } from '@/utils/browserStateKeys';

// DMM Mobile is a native app: over https it sends neither Origin nor Sec-Fetch-Site.
const APP = { host: 'dmm.test', 'x-forwarded-proto': 'https' };
// The /tv page in a browser.
const PAGE = { ...APP, origin: 'https://dmm.test', 'sec-fetch-site': 'same-origin' };

async function call(
	handler: typeof pair,
	body?: unknown,
	headers: Record<string, string> = APP,
	ip = '203.0.113.7',
	method = 'POST'
) {
	const res = createMockResponse();
	await handler(
		createMockRequest({ method, body, headers: { 'cf-connecting-ip': ip, ...headers } }),
		res
	);
	const status = vi.mocked(res.status).mock.calls.at(-1)?.[0];
	const json = vi.mocked(res.json).mock.calls.at(-1)?.[0];
	return { status, json, headers: res._getHeaders() };
}

// What collectState() sends from a browser signed in to Real-Debrid (device-code triple) and AllDebrid.
const STATE = {
	'rd:clientId': '"cid"',
	'rd:clientSecret': '"secret"',
	'rd:refreshToken': '"refresh"',
	'rd:accessToken': '{"value":"access","expiry":1893456000000}',
	'ad:apiKey': '"adkey"',
	'trakt:accessToken': '"trakt"',
	'settings:player': 'android/org.videolan.vlc',
	'settings:syncAcrossDevices': 'true',
};

const start = async () => (await call(pair)).json;
const approveWith = (userCode: string, state: unknown, extra: object = {}, ip?: string) =>
	call(approve, { userCode, state, ...extra }, PAGE, ip);

beforeEach(() => {
	process.env.DMM_ORIGIN = 'https://configured.test';
});

describe('/api/tv pairing', () => {
	it('hands the TV the browser state once: pair, approve, poll', async () => {
		const started = await call(pair);
		expect(started.status).toBe(200);
		expect(started.headers['Cache-Control']).toBe('no-store');
		expect(started.json).toMatchObject({ interval: 3, expiresIn: 600 });
		expect(started.json.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		expect(started.json.verifyUrl).toBe(
			`https://dmm.test/tv?code=${started.json.userCode.replace('-', '')}`
		);
		const { deviceCode } = started.json;

		const pending = await call(poll, { deviceCode });
		expect(pending.status).toBe(202);
		expect(pending.headers['Cache-Control']).toBe('no-store');

		const approved = await approveWith(started.json.userCode.toLowerCase(), {
			...STATE,
			// Per-browser state and anything not a synced key stays behind.
			'rd:castToken': '"cast"',
			'dmm:guest': 'true',
			'library:lastSync': '123',
			'settings:notAString': 42,
		});
		expect(approved.status).toBe(200);
		// Which services went over, never their keys.
		expect(approved.json).toEqual({ services: ['rd', 'ad'] });

		const collected = await call(poll, { deviceCode });
		expect(collected.status).toBe(200);
		expect(collected.headers['Cache-Control']).toBe('no-store');
		expect(collected.json).toEqual({ status: 'linked', state: STATE });
		expect((await call(poll, { deviceCode })).status).toBe(410);
	});

	it('answers DMM Mobile, which sends no Origin and no Sec-Fetch-Site', async () => {
		const started = await call(pair, undefined, APP);
		expect(started.status).toBe(200);
		expect((await call(poll, { deviceCode: started.json.deviceCode }, APP)).status).toBe(202);
		expect(
			(await call(approve, { userCode: started.json.userCode, state: STATE }, APP)).status
		).toBe(200);
		expect((await call(poll, { deviceCode: started.json.deviceCode }, APP)).status).toBe(200);
	});

	it('refuses a browser with no debrid sign-in, however much else it holds', async () => {
		const { userCode, deviceCode } = await start();
		const refused = await approveWith(userCode, {
			'settings:player': 'android/org.videolan.vlc',
			'trakt:accessToken': '"trakt"',
			'en:account': '{"username":"u","password":"p"}',
			'rd:accessToken': '',
		});
		expect(refused.status).toBe(400);
		expect(refused.json.error).toMatch(/Sign in to a debrid service on DMM first/);
		expect((await call(poll, { deviceCode })).status).toBe(202);
		// The code is still good once the browser signs in.
		expect((await approveWith(userCode, STATE)).status).toBe(200);
	});

	it('refuses a state over the size the browser sync allows', async () => {
		const { userCode, deviceCode } = await start();
		const big = { ...STATE, 'settings:big': 'x'.repeat(MAX_STATE_BYTES) };
		expect((await approveWith(userCode, big)).status).toBe(413);
		expect((await call(poll, { deviceCode })).status).toBe(202);
	});

	it('refuses a bad code, an unknown code and a reused code', async () => {
		const { userCode } = await start();
		expect((await approveWith('nope', STATE)).status).toBe(400);
		expect((await approveWith('ABCD-EFGH', STATE)).status).toBe(404);
		expect((await approveWith(userCode, STATE)).status).toBe(200);
		const reused = await approveWith(userCode, STATE);
		expect(reused.status).toBe(409);
		expect(reused.json.error).toMatch(/already used/);
	});

	it('asks the browser to confirm a TV on another connection before handing anything over', async () => {
		const { userCode, deviceCode } = await start();
		const refused = await approveWith(userCode, STATE, {}, '198.51.100.9');
		expect(refused.status).toBe(428);
		expect(refused.json.otherNetwork).toBe(true);
		expect(refused.json.error).toMatch(/your own TV/);
		expect((await call(poll, { deviceCode })).status).toBe(202);

		const confirmed = await approveWith(
			userCode,
			STATE,
			{ confirmOtherNetwork: true },
			'198.51.100.9'
		);
		expect(confirmed.status).toBe(200);
		expect((await call(poll, { deviceCode })).json.state).toEqual(STATE);
	});

	it('says a code has expired once its ten minutes are up', async () => {
		vi.useFakeTimers();
		try {
			const { userCode, deviceCode } = await start();
			vi.advanceTimersByTime(601 * 1000);
			expect((await call(poll, { deviceCode })).status).toBe(410);
			expect((await approveWith(userCode, STATE)).status).toBe(404);
		} finally {
			vi.useRealTimers();
		}
	});

	it('only takes POST, and a well-formed device code', async () => {
		expect((await call(pair, undefined, APP, undefined, 'GET')).status).toBe(405);
		expect((await call(poll, {}, APP, undefined, 'GET')).status).toBe(405);
		expect((await call(approve, {}, PAGE, undefined, 'GET')).status).toBe(405);
		expect((await call(poll, { deviceCode: 'short' })).status).toBe(400);
	});
});
