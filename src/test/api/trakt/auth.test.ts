import handler from '@/pages/api/trakt/auth';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('/api/trakt/auth', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.TRAKT_CLIENT_ID = 'test-client-id';
	});

	it('returns 400 when redirect is missing', async () => {
		const req = createMockRequest({ query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing redirect parameter' });
	});

	it('returns 400 when redirect is not in allowed origins', async () => {
		const req = createMockRequest({ query: { redirect: 'https://evil.com' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid redirect origin' });
	});

	it('redirects to Trakt OAuth URL for localhost:3000', async () => {
		const req = createMockRequest({ query: { redirect: 'http://localhost:3000' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.redirect).toHaveBeenCalledWith(
			expect.stringContaining('https://trakt.tv/oauth/authorize')
		);
		const url = (res.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(url).toContain('client_id=test-client-id');
		expect(url).toContain(encodeURIComponent('http://localhost:3000/trakt/callback'));
	});

	it('redirects to Trakt OAuth URL for 127.0.0.1:3000', async () => {
		const req = createMockRequest({ query: { redirect: 'http://127.0.0.1:3000' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.redirect).toHaveBeenCalledWith(
			expect.stringContaining('https://trakt.tv/oauth/authorize')
		);
		const url = (res.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(url).toContain(encodeURIComponent('http://127.0.0.1:3000/trakt/callback'));
	});

	it('redirects to Trakt OAuth URL for debridmediamanager.com', async () => {
		const req = createMockRequest({
			query: { redirect: 'https://debridmediamanager.com' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.redirect).toHaveBeenCalledWith(
			expect.stringContaining('https://trakt.tv/oauth/authorize')
		);
		const url = (res.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(url).toContain(encodeURIComponent('https://debridmediamanager.com/trakt/callback'));
	});

	it('redirects to Trakt OAuth URL for www.debridmediamanager.com', async () => {
		const req = createMockRequest({
			query: { redirect: 'https://www.debridmediamanager.com' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.redirect).toHaveBeenCalledWith(
			expect.stringContaining('https://trakt.tv/oauth/authorize')
		);
		const url = (res.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(url).toContain(
			encodeURIComponent('https://www.debridmediamanager.com/trakt/callback')
		);
	});

	it('includes response_type=code in the redirect URL', async () => {
		const req = createMockRequest({ query: { redirect: 'http://localhost:3000' } });
		const res = createMockResponse();

		await handler(req, res);

		const url = (res.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(url).toContain('response_type=code');
	});
});
