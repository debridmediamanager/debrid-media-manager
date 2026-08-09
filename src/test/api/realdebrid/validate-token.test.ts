import handler from '@/pages/api/realdebrid/validate-token';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const run = async (body: unknown, method = 'POST') => {
	const res = createMockResponse();
	await handler(createMockRequest({ method, body }) as any, res as any);
	return res;
};

beforeEach(() => vi.clearAllMocks());

describe('POST /api/realdebrid/validate-token', () => {
	it('reports a good token and the account it belongs to', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ username: 'ben', premium: 86400 }),
		}) as any;

		const res = await run({ token: 'GOODTOKEN' });

		expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
			'https://app.real-debrid.com/rest/1.0/user'
		);
		expect(res._getData()).toEqual({ valid: true, username: 'ben', premium: true });
	});

	it('marks a lapsed account as not premium', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ username: 'ben', premium: 0 }),
		}) as any;

		expect((await run({ token: 'GOODTOKEN' }))._getData()).toEqual({
			valid: true,
			username: 'ben',
			premium: false,
		});
	});

	it.each([[401], [403]])('reports a token Real-Debrid refuses (%i)', async (status) => {
		global.fetch = vi.fn().mockResolvedValue({ ok: false, status }) as any;
		const res = await run({ token: 'BADTOKEN' });
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ valid: false });
	});

	// The distinction the page depends on: an unreachable RD must never be
	// reported as a rejected token.
	it('never claims a token is invalid when the call failed', async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error('ETIMEDOUT')) as any;
		const res = await run({ token: 'GOODTOKEN' });
		expect(res._getStatusCode()).toBe(502);
		expect(res._getData()).not.toHaveProperty('valid');
	});

	it('treats any other Real-Debrid status as unknown, not invalid', async () => {
		global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
		const res = await run({ token: 'GOODTOKEN' });
		expect(res._getStatusCode()).toBe(502);
		expect(res._getData()).not.toHaveProperty('valid');
	});

	it('rejects a request with no token', async () => {
		global.fetch = vi.fn() as any;
		expect((await run({}))._getStatusCode()).toBe(400);
		expect((await run({ token: '   ' }))._getStatusCode()).toBe(400);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('is POST only, so the token stays out of access logs', async () => {
		global.fetch = vi.fn() as any;
		expect((await run({ token: 'X' }, 'GET'))._getStatusCode()).toBe(405);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('never echoes the token back', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ username: 'ben', premium: 1, secret: 'SECRETTOKEN' }),
		}) as any;

		const res = await run({ token: 'SECRETTOKEN' });
		expect(JSON.stringify(res._getData())).not.toContain('SECRETTOKEN');
	});
});
