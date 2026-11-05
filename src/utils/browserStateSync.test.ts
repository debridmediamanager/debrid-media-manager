import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_ENABLED_KEY } from './browserStateKeys';
import {
	applyState,
	collectState,
	fetchBrowserState,
	forgetBrowserState,
	saveBrowserState,
	syncIdentities,
} from './browserStateSync';

const set = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
const envelope = (value: string, expiry: number) => ({ value, expiry });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('collectState', () => {
	it('takes synced keys as raw strings and leaves the rest', () => {
		set('rd:accessToken', envelope('tok', 123));
		set('settings:player', 'web');
		set('dmm:accounts:rd', [{ id: '1' }]);
		set('rd:castToken', 'per-browser');
		set('dmm:guest', true);

		expect(collectState()).toEqual({
			'rd:accessToken': '{"value":"tok","expiry":123}',
			'settings:player': '"web"',
			'dmm:accounts:rd': '[{"id":"1"}]',
		});
	});
});

describe('applyState', () => {
	it('writes allowed keys, skips the rest, and announces each write', () => {
		const announced: string[] = [];
		const listener = (e: Event) => announced.push((e as CustomEvent).detail.key);
		window.addEventListener('local-storage', listener);

		applyState({
			'tb:apiKey': '"tb-key"',
			[SYNC_ENABLED_KEY]: 'true',
			'rd:castToken': '"nope"',
			'dmm:syncRestoreTried': '1',
		});
		window.removeEventListener('local-storage', listener);

		expect(localStorage.getItem('tb:apiKey')).toBe('"tb-key"');
		expect(localStorage.getItem(SYNC_ENABLED_KEY)).toBe('true');
		expect(localStorage.getItem('rd:castToken')).toBeNull();
		expect(localStorage.getItem('dmm:syncRestoreTried')).toBeNull();
		expect(announced.sort()).toEqual([SYNC_ENABLED_KEY, 'tb:apiKey']);
	});

	it('keeps a login this browser already holds', () => {
		set('tb:apiKey', 'fresh');
		applyState({ 'tb:apiKey': '"rotated-away"', 'ad:apiKey': '"ad-key"' });
		expect(localStorage.getItem('tb:apiKey')).toBe('"fresh"');
		expect(localStorage.getItem('ad:apiKey')).toBe('"ad-key"');
	});
});

describe('syncIdentities', () => {
	it('is empty with no logins', () => {
		expect(syncIdentities()).toEqual([]);
	});

	it('prefers the Real-Debrid OAuth triple over the access token', () => {
		set('rd:clientId', 'id');
		set('rd:clientSecret', 'secret');
		set('rd:refreshToken', 'refresh');
		set('rd:accessToken', envelope('tok', Date.now() + 60_000));
		expect(syncIdentities()).toEqual([
			{ service: 'rd', clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
		]);
	});

	it('falls back to an unexpired Real-Debrid access token envelope', () => {
		set('rd:clientId', 'id');
		set('rd:accessToken', envelope('tok', Date.now() + 60_000));
		expect(syncIdentities()).toEqual([{ service: 'rd', apiKey: 'tok' }]);
	});

	it('takes a pasted Real-Debrid key stored without an expiry', () => {
		set('rd:accessToken', 'pasted');
		expect(syncIdentities()).toEqual([{ service: 'rd', apiKey: 'pasted' }]);
	});

	it('skips an expired envelope', () => {
		set('rd:accessToken', envelope('tok', Date.now() - 1));
		expect(syncIdentities()).toEqual([]);
	});

	it('reads every other provider, OAuth token before pasted key', () => {
		set('tb:apiKey', 'tb');
		set('ad:apiKey', 'ad');
		set('pm:apiKey', 'pm-key');
		set('pm:accessToken', 'pm-oauth');
		set('oc:apiKey', 'oc');
		set('dl:apiKey', 'dl-key');
		expect(syncIdentities()).toEqual([
			{ service: 'tb', apiKey: 'tb' },
			{ service: 'ad', apiKey: 'ad' },
			{ service: 'pm', apiKey: 'pm-oauth' },
			{ service: 'oc', apiKey: 'oc' },
			{ service: 'dl', apiKey: 'dl-key' },
		]);
		set('dl:accessToken', 'dl-oauth');
		expect(syncIdentities().at(-1)).toEqual({ service: 'dl', apiKey: 'dl-oauth' });
	});

	it('takes the DMM API key as a login of its own, after any provider', () => {
		localStorage.setItem('dmm:apiKey', JSON.stringify('k'.repeat(64)));
		expect(syncIdentities()).toEqual([{ service: 'dmm', apiKey: 'k'.repeat(64) }]);
		localStorage.setItem('tb:apiKey', '"tb-key"');
		expect(syncIdentities().map((i) => i.service)).toEqual(['tb', 'dmm']);
	});

	it('ignores a value that is not JSON', () => {
		localStorage.setItem('tb:apiKey', '{broken');
		expect(syncIdentities()).toEqual([]);
	});
});

describe('requests', () => {
	const identity = { service: 'tb', apiKey: 'tb' } as const;
	const stubFetch = (response: Partial<Response> | Error) => {
		const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
			response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
		);
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	};

	it('sends JSON bodies, never credentials in the URL', async () => {
		const fetchMock = stubFetch({ ok: true, status: 200 });
		await saveBrowserState([identity], { 'tb:apiKey': '"tb"' });
		await forgetBrowserState([identity]);

		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			'/api/browser-state',
			'/api/browser-state',
		]);
		const [[, put], [, del]] = fetchMock.mock.calls;
		expect(put).toMatchObject({ method: 'PUT', credentials: 'same-origin' });
		expect(JSON.parse(put.body as string)).toEqual({
			identities: [identity],
			state: { 'tb:apiKey': '"tb"' },
		});
		expect(del.method).toBe('DELETE');
		expect(JSON.parse(del.body as string)).toEqual({ identities: [identity] });
	});

	it('returns the stored state', async () => {
		const fetchMock = stubFetch({
			status: 200,
			json: async () => ({ state: { 'ad:apiKey': '"ad"' }, updatedAt: 'x' }),
		});
		expect(await fetchBrowserState(identity)).toEqual({ 'ad:apiKey': '"ad"' });
		expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ identity });
	});

	it('returns null only when nothing is stored, not when authentication fails', async () => {
		stubFetch({ status: 204 });
		expect(await fetchBrowserState(identity)).toBeNull();
		stubFetch({ status: 401 });
		await expect(fetchBrowserState(identity)).rejects.toThrow('401');
	});

	// No answer is not "nothing stored": the caller must be able to ask again.
	it('throws when there was no answer', async () => {
		stubFetch(new Error('offline'));
		await expect(fetchBrowserState(identity)).rejects.toThrow('offline');
		stubFetch({ status: 429 });
		await expect(fetchBrowserState(identity)).rejects.toThrow('429');
		stubFetch({ status: 502 });
		await expect(fetchBrowserState(identity)).rejects.toThrow('502');
	});

	it('reports a failed save or forget as false', async () => {
		stubFetch({ ok: false, status: 401 });
		expect(await saveBrowserState([identity], {})).toBe(false);
		stubFetch(new Error('offline'));
		expect(await forgetBrowserState([identity])).toBe(false);
	});
});
