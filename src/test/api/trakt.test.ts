import { beforeEach, describe, expect, it, vi } from 'vitest';

import authHandler from '@/pages/api/trakt/auth';
import exchangeHandler from '@/pages/api/trakt/exchange';

const originalEnv = { ...process.env };

const createRes = () => {
	const res: any = {
		status: vi.fn().mockReturnThis(),
		json: vi.fn(),
		redirect: vi.fn(),
	};
	return res;
};

beforeEach(() => {
	process.env = {
		...originalEnv,
		TRAKT_CLIENT_ID: 'client-id',
		TRAKT_CLIENT_SECRET: 'secret',
	};
	vi.clearAllMocks();
});

describe('API /api/trakt/auth', () => {
	it('redirects to trakt oauth', async () => {
		const res = createRes();
		await authHandler({ query: { redirect: 'https://debridmediamanager.com' } } as any, res);
		expect(res.redirect).toHaveBeenCalledWith(
			`https://trakt.tv/oauth/authorize?response_type=code&client_id=client-id&redirect_uri=${encodeURIComponent('https://debridmediamanager.com/trakt/callback')}`
		);
	});

	it('rejects invalid redirect origins', async () => {
		const res = createRes();
		await authHandler({ query: { redirect: 'https://evil.com' } } as any, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.redirect).not.toHaveBeenCalled();
	});
});

describe('API /api/trakt/exchange', () => {
	it('validates the code parameter', async () => {
		const res = createRes();
		await exchangeHandler({ query: {} } as any, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('proxies the token exchange response', async () => {
		const text = vi.fn().mockResolvedValue(JSON.stringify({ access_token: 'tok' }));
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text } as any);
		const res = createRes();

		await exchangeHandler({ query: { code: 'abc', redirect: 'https://app' } } as any, res);

		expect(globalThis.fetch).toHaveBeenCalledWith(
			'https://api.trakt.tv/oauth/token',
			expect.objectContaining({
				method: 'POST',
			})
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ access_token: 'tok' });
	});
});
