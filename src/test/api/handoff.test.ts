import createHandler from '@/pages/api/handoff';
import redeemHandler from '@/pages/api/handoff/redeem';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { redeemBrowserHandoff } from '@/utils/browserHandoff';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (wrapped: unknown) => wrapped };
});

// What DMM Mobile's stateFromApp sends: raw localStorage strings in DMM web's format.
const APP_STATE = {
	'rd:accessToken': '{"value":"AT","expiry":4102444800000}',
	'rd:refreshToken': '"RT"',
	'pm:apiKey': '"pm-key"',
	'settings:player': '"vlc"',
	'settings:syncAcrossDevices': 'true',
	'not:synced': 'dropped',
};

async function call(handler: unknown, body: unknown, headers: Record<string, string> = {}) {
	const req = createMockRequest({ method: 'POST', body, headers });
	const res = createMockResponse();
	await (handler as (req: never, res: never) => Promise<void>)(req as never, res as never);
	return { status: res._getStatusCode(), data: res._getData() as any };
}

const create = (state: unknown) => call(createHandler, { state });
const redeem = (code: unknown, site = 'same-origin') =>
	call(redeemHandler, { code }, { 'sec-fetch-site': site });

describe('/api/handoff', () => {
	it('hands the synced state to one DMM page, once', async () => {
		const created = await create(APP_STATE);
		expect(created.status).toBe(200);
		expect(created.data.code).toMatch(/^[A-Za-z0-9_-]{43}$/);

		const taken = await redeem(created.data.code);
		expect(taken.status).toBe(200);
		expect(taken.data.state).not.toHaveProperty('not:synced');
		expect(taken.data.state['rd:refreshToken']).toBe('"RT"');

		expect((await redeem(created.data.code)).status).toBe(410);
	});

	it('refuses a state with no debrid login', async () => {
		expect((await create({ 'settings:player': '"vlc"' })).status).toBe(400);
	});

	// The answer is a bag of credentials: another site's script must not take it.
	it('refuses a cross-site redeem without spending the code', async () => {
		const { data } = await create(APP_STATE);

		expect((await redeem(data.code, 'cross-site')).status).toBe(403);
		expect((await redeem(data.code)).status).toBe(200);
	});

	it('refuses a malformed code', async () => {
		expect((await redeem('short')).status).toBe(400);
	});
});

describe('redeemBrowserHandoff', () => {
	const originalLocation = window.location;
	let reload: ReturnType<typeof vi.fn>;

	async function openWith(code: string) {
		reload = vi.fn();
		Object.defineProperty(window, 'location', {
			writable: true,
			value: { hash: `#handoff=${code}`, pathname: '/movie/tt0111161', search: '', reload },
		});
		vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
			const { status, data } = await redeem(JSON.parse(String(init.body)).code);
			return { ok: status === 200, json: async () => data };
		});
		await redeemBrowserHandoff();
	}

	beforeEach(() => localStorage.clear());
	afterEach(() => {
		Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('signs a fresh browser in as the app is, then reloads without the code', async () => {
		const { data } = await create(APP_STATE);
		await openWith(data.code);

		expect(localStorage.getItem('rd:refreshToken')).toBe('"RT"');
		expect(localStorage.getItem('pm:apiKey')).toBe('"pm-key"');
		expect(localStorage.getItem('settings:player')).toBe('"vlc"');
		expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/movie/tt0111161');
		expect(reload).toHaveBeenCalled();
	});

	// A sent link must not sign a stranger's browser in with "remember across devices" on,
	// or that browser's own logins would be saved behind the sender's account.
	it('never turns on remember across devices', async () => {
		const { data } = await create(APP_STATE);
		await openWith(data.code);

		expect(localStorage.getItem('settings:syncAcrossDevices')).toBeNull();
	});

	it('leaves a signed-in browser as it is but spends the code', async () => {
		localStorage.setItem('ad:apiKey', '"own-ad"');
		const { data } = await create(APP_STATE);
		await openWith(data.code);

		expect(localStorage.getItem('rd:refreshToken')).toBeNull();
		expect(localStorage.getItem('ad:apiKey')).toBe('"own-ad"');
		expect((await redeem(data.code)).status).toBe(410);
		expect(reload).toHaveBeenCalled();
	});

	it('reloads signed out when the code is spent', async () => {
		const { data } = await create(APP_STATE);
		await redeem(data.code);
		await openWith(data.code);

		expect(localStorage.getItem('rd:refreshToken')).toBeNull();
		expect(reload).toHaveBeenCalled();
	});
});
