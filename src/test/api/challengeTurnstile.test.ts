import handler from '@/pages/api/challenge';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A DMM page in a browser: same-origin, behind the https proxy.
const PAGE = {
	'x-forwarded-proto': 'https',
	'sec-fetch-site': 'same-origin',
	'x-real-ip': '198.51.100.9',
};

const call = async (headers: Record<string, string>) => {
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'GET', headers: headers as any }), res as any);
	return res;
};

const siteverify = (answer: (body: URLSearchParams) => Response | Promise<Response>) => {
	const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
		answer(init.body as URLSearchParams)
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
};

describe('GET /api/challenge behind Turnstile', () => {
	const originalEnv = process.env;
	beforeEach(() => {
		process.env = {
			...originalEnv,
			DMM_PROBLEM_SECRET: 'test-secret',
			TURNSTILE_SITE_KEY: '0xSITE',
			TURNSTILE_SECRET_KEY: '0xSECRET',
		};
		delete process.env.REDIS_URL;
	});
	afterEach(() => {
		process.env = originalEnv;
		vi.unstubAllGlobals();
	});

	it('asks a page without an answer to run the check, and mints nothing', async () => {
		const fetchMock = siteverify(() => Response.json({ success: true }));
		const res = await call(PAGE);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res._getData()).toMatchObject({ turnstile: '0xSITE' });
		expect(res._getData()).not.toHaveProperty('token');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('mints a token once Cloudflare accepts the answer, sending the secret and visitor IP', async () => {
		const fetchMock = siteverify(() => Response.json({ success: true }));
		const res = await call({ ...PAGE, 'x-turnstile-token': 'answer-1' });
		expect(res.status).toHaveBeenCalledWith(200);
		const { token, hash } = res._getData() as { token: string; hash: string };
		expect(validateProblemToken(token, hash)).toBe(true);
		const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://challenges.cloudflare.com/turnstile/v0/siteverify'
		);
		expect(body.get('secret')).toBe('0xSECRET');
		expect(body.get('response')).toBe('answer-1');
		expect(body.get('remoteip')).toBe('198.51.100.9');
	});

	it('refuses an answer Cloudflare rejects', async () => {
		siteverify(() =>
			Response.json({ success: false, 'error-codes': ['invalid-input-response'] })
		);
		const res = await call({ ...PAGE, 'x-turnstile-token': 'forged' });
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res._getData()).toMatchObject({ turnstile: '0xSITE' });
	});

	// Cloudflare being down must not take every title page down with it.
	it('still mints when Cloudflare cannot be reached', async () => {
		siteverify(() => {
			throw new Error('ECONNRESET');
		});
		const res = await call({ ...PAGE, 'x-turnstile-token': 'answer-2' });
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('is off without both keys, as for a self-hosted DMM', async () => {
		delete process.env.TURNSTILE_SECRET_KEY;
		const fetchMock = siteverify(() => Response.json({ success: false }));
		const res = await call(PAGE);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('still refuses a script before asking Cloudflare anything', async () => {
		const fetchMock = siteverify(() => Response.json({ success: true }));
		const res = await call({ 'x-forwarded-proto': 'https', 'x-turnstile-token': 'answer-3' });
		expect(res.status).toHaveBeenCalledWith(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
