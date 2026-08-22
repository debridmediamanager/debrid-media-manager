import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	handlePremiumizeProxyRequest,
	isAllowedEndpoint,
	joinEndpoint,
	readApiKey,
} from './premiumizeProxy';

const jsonResponse = (body: unknown, status = 200) =>
	({
		status,
		headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
		json: async () => body,
	}) as unknown as Response;

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('readApiKey', () => {
	it('accepts exactly the form Premiumize accepts', () => {
		expect(readApiKey('Bearer abc123')).toBe('abc123');
		expect(readApiKey('  Bearer abc123  ')).toBe('abc123');
	});

	it('rejects everything else', () => {
		expect(readApiKey('bearer abc123')).toBeNull();
		expect(readApiKey('Token abc123')).toBeNull();
		expect(readApiKey('abc123')).toBeNull();
		expect(readApiKey(undefined)).toBeNull();
		expect(readApiKey(['Bearer a', 'Bearer b'])).toBeNull();
	});
});

describe('joinEndpoint', () => {
	it('rebuilds the vendor path from the catch-all segments', () => {
		expect(joinEndpoint(['transfer', 'directdl'])).toBe('transfer/directdl');
		expect(joinEndpoint('account')).toBe('account');
		expect(joinEndpoint(undefined)).toBe('');
	});
});

describe('isAllowedEndpoint', () => {
	it('allows the endpoints DMM uses, including the virtual hash lookup', () => {
		expect(isAllowedEndpoint('cache/check')).toBe(true);
		expect(isAllowedEndpoint('transfer/hashes')).toBe(true);
	});

	it('blocks state-creating and undocumented endpoints', () => {
		// feed/create makes a real, unaddressable feed from zero parameters
		expect(isAllowedEndpoint('feed/create')).toBe(false);
		expect(isAllowedEndpoint('folder/paste')).toBe(false);
		expect(isAllowedEndpoint('folder/uploadinfo')).toBe(false);
		expect(isAllowedEndpoint('job/src')).toBe(false);
	});
});

describe('handlePremiumizeProxyRequest', () => {
	const post = (over: Record<string, unknown> = {}) => ({
		method: 'POST',
		endpoint: 'account/info',
		authorization: 'Bearer key',
		body: {},
		...over,
	});

	it('refuses anything but POST, because Premiumize deletes on GET', async () => {
		const result = await handlePremiumizeProxyRequest(
			post({ method: 'GET', endpoint: 'transfer/delete' })
		);

		expect(result.httpStatus).toBe(405);
		expect(result.allowHeader).toBe('POST');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses an endpoint outside the allow list before authenticating', async () => {
		const result = await handlePremiumizeProxyRequest(post({ endpoint: 'feed/create' }));

		expect(result.httpStatus).toBe(404);
		expect(result.body.code).toBe('not_found');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses a request with no usable key', async () => {
		const result = await handlePremiumizeProxyRequest(post({ authorization: 'bearer key' }));

		expect(result.httpStatus).toBe(401);
		expect(result.body.code).toBe('authentication_failed');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('forwards the key as a single Bearer header and never in the URL', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'success' }));

		await handlePremiumizeProxyRequest(post({ authorization: 'Bearer secret' }));

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://www.premiumize.me/api/account/info');
		expect(url).not.toContain('secret');
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe('Bearer secret');
	});

	it('encodes repeated array params as Premiumize expects', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ status: 'success', response: [] }));

		await handlePremiumizeProxyRequest(
			post({ endpoint: 'cache/check', body: { 'items[]': ['aaa', 'bbb'] } })
		);

		expect(fetchMock.mock.calls[0][1].body).toBe('items%5B%5D=aaa&items%5B%5D=bbb');
	});

	it('passes an upstream error envelope through untouched', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ status: 'error', code: 'transient_error', message: 'nope' })
		);

		const result = await handlePremiumizeProxyRequest(post());

		expect(result.httpStatus).toBe(200);
		expect(result.body).toEqual({ status: 'error', code: 'transient_error', message: 'nope' });
	});

	it('reports a transport failure as an envelope rather than throwing', async () => {
		fetchMock.mockRejectedValue(new Error('socket hang up'));

		const result = await handlePremiumizeProxyRequest(post());

		expect(result.httpStatus).toBe(502);
		expect(result.body).toMatchObject({ code: 'transient_error', message: 'socket hang up' });
	});

	it('resolves transfer hashes from the job/src redirect', async () => {
		fetchMock.mockResolvedValue({
			status: 302,
			headers: {
				get: (name: string) =>
					name === 'location'
						? 'magnet:?xt=urn:btih:DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C&dn=Big+Buck+Bunny'
						: null,
			},
		} as unknown as Response);

		const result = await handlePremiumizeProxyRequest(
			post({ endpoint: 'transfer/hashes', body: { ids: ['abc', '', 42] } })
		);

		expect(result.httpStatus).toBe(200);
		expect(result.body.hashes).toEqual({
			abc: 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
		});
		// the empty string and the non-string are dropped, so only one lookup runs
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('leaves a transfer out of the hash map when job/src has no magnet', async () => {
		fetchMock.mockResolvedValue({
			status: 302,
			headers: { get: () => 'https://proof.ovh.net/files/1Mb.dat' },
		} as unknown as Response);

		const result = await handlePremiumizeProxyRequest(
			post({ endpoint: 'transfer/hashes', body: { ids: ['abc'] } })
		);

		expect(result.body.hashes).toEqual({});
	});
});
