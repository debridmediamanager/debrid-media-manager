import handler from '@/pages/api/proxy/stream';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { mintProblemToken } from '@/utils/problemToken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAxiosGet, mockSocksProxyAgent } = vi.hoisted(() => ({
	mockAxiosGet: vi.fn(),
	mockSocksProxyAgent: vi.fn((_uri: string, _opts?: unknown) => ({ proxy: true })),
}));

vi.mock('axios', () => {
	const axiosMock = {
		get: mockAxiosGet,
		isAxiosError: (error: any) => Boolean(error?.isAxiosError),
	};
	return { default: axiosMock };
});

vi.mock('socks-proxy-agent', () => ({
	SocksProxyAgent: mockSocksProxyAgent,
}));

describe('/api/proxy/stream', () => {
	// Every caller has to present a token this server signed, so the happy-path
	// cases mint a real one rather than mocking the check away.
	let auth: { dmmProblemKey: string; solution: string };

	beforeEach(() => {
		vi.clearAllMocks();
		mockAxiosGet.mockResolvedValue({ data: { ok: true } });
		process.env.PROXY = 'localhost:9050';
		process.env.REQUEST_TIMEOUT = '4000';
		process.env.DMM_PROBLEM_SECRET = 'test-secret';
		const [token, hash] = mintProblemToken('test-secret');
		auth = { dmmProblemKey: token, solution: hash };
	});

	it('rejects unsupported methods', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('validates url and service parameters', async () => {
		const req = createMockRequest({ query: { ...auth } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('rejects non-whitelisted hosts', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: { ...auth, url: 'https://example.com/data', service: 'comet' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Host not allowed' });
	});

	it('refuses a caller with no token', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: { url: 'https://comet.elfhosted.com/api', service: 'comet-tor' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(mockAxiosGet).not.toHaveBeenCalled();
	});

	it('refuses a token this server did not sign', async () => {
		const [token] = mintProblemToken('someone-elses-secret');
		const req = createMockRequest({
			method: 'GET',
			query: {
				url: 'https://comet.elfhosted.com/api',
				service: 'comet-tor',
				dmmProblemKey: token,
				solution: 'forged',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(mockAxiosGet).not.toHaveBeenCalled();
	});

	it('refuses a browser calling from another site even with a valid token', async () => {
		const req = createMockRequest({
			method: 'GET',
			headers: { 'sec-fetch-site': 'cross-site' },
			query: { ...auth, url: 'https://comet.elfhosted.com/api', service: 'comet-tor' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(mockAxiosGet).not.toHaveBeenCalled();
	});

	it('allows the site itself', async () => {
		const req = createMockRequest({
			method: 'GET',
			headers: { 'sec-fetch-site': 'same-origin' },
			query: { ...auth, url: 'https://comet.elfhosted.com/api', service: 'comet-tor' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('proxies requests without TOR when service is direct', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: { ...auth, url: 'https://comet.elfhosted.com/api', service: 'comet' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSocksProxyAgent).not.toHaveBeenCalled();
		expect(mockAxiosGet).toHaveBeenCalledWith(
			'https://comet.elfhosted.com/api',
			expect.objectContaining({
				timeout: 30000,
				headers: expect.objectContaining({ referer: 'https://web.stremio.com/' }),
			})
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ ok: true });
	});

	it('proxies using TOR when service requires it', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: { ...auth, url: 'https://comet.elfhosted.com/api', service: 'comet-tor' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSocksProxyAgent).toHaveBeenCalledWith(
			expect.stringContaining('localhost:9050'),
			expect.objectContaining({ timeout: 4000 })
		);
		expect(mockAxiosGet).toHaveBeenCalledWith(
			'https://comet.elfhosted.com/api',
			expect.objectContaining({
				httpAgent: expect.any(Object),
				httpsAgent: expect.any(Object),
			})
		);
	});

	it('gives every TOR request its own circuit', async () => {
		// Tor isolates circuits on the SOCKS username, so two requests sharing one
		// leave from the same exit IP. The username was Date.now(), and a burst of
		// handler calls lands inside a single millisecond - so pin the clock and
		// check the usernames still differ.
		const pinnedNow = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(pinnedNow);
		const [token, hash] = mintProblemToken('test-secret', pinnedNow);

		const callTor = async () => {
			const req = createMockRequest({
				method: 'GET',
				query: {
					dmmProblemKey: token,
					solution: hash,
					url: 'https://comet.elfhosted.com/api',
					service: 'comet-tor',
				},
			});
			await handler(req, createMockResponse());
		};

		await callTor();
		await callTor();

		const usernames = mockSocksProxyAgent.mock.calls.map(
			([uri]) => uri.split('//')[1].split(':')[0]
		);
		expect(usernames).toHaveLength(2);
		expect(usernames[0]).not.toBe(usernames[1]);

		nowSpy.mockRestore();
	});

	it('returns upstream status codes for axios errors', async () => {
		mockAxiosGet.mockRejectedValue({
			isAxiosError: true,
			response: { status: 502, data: 'bad gateway' },
		});
		const req = createMockRequest({
			method: 'GET',
			query: { ...auth, url: 'https://comet.elfhosted.com/api', service: 'comet' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(502);
		expect(res.json).toHaveBeenCalledWith({ error: 'bad gateway' });
	});

	it('returns 500 for generic errors', async () => {
		mockAxiosGet.mockRejectedValue(new Error('boom'));
		const req = createMockRequest({
			method: 'GET',
			query: { ...auth, url: 'https://comet.elfhosted.com/api', service: 'comet' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
	});
});
