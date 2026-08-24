import { recordRdOperationEvent } from '@/lib/observability/rdOperationalStats';
import { recordTorBoxOperationEvent } from '@/lib/observability/torboxOperationalStats';
import handler from '@/pages/api/anticors';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/observability/rdOperationalStats', async () => {
	const actual = await vi.importActual<typeof import('@/lib/observability/rdOperationalStats')>(
		'@/lib/observability/rdOperationalStats'
	);
	return { ...actual, recordRdOperationEvent: vi.fn() };
});

vi.mock('@/lib/observability/torboxOperationalStats', async () => {
	const actual = await vi.importActual<
		typeof import('@/lib/observability/torboxOperationalStats')
	>('@/lib/observability/torboxOperationalStats');
	return { ...actual, recordTorBoxOperationEvent: vi.fn() };
});

vi.mock('crypto', async () => {
	const actual = await vi.importActual<typeof import('crypto')>('crypto');
	return {
		...actual,
		randomUUID: vi.fn(() => 'uuid-123'),
	};
});

const originalFetch = global.fetch;

beforeAll(() => {
	global.fetch = vi.fn();
});

afterAll(() => {
	global.fetch = originalFetch;
});

beforeEach(() => {
	vi.clearAllMocks();
});

const asAsyncIterable = (req: any, chunks: Array<string | Buffer>) => {
	req[Symbol.asyncIterator] = async function* () {
		for (const chunk of chunks) {
			yield chunk;
		}
	};
	return req;
};

describe('/api/anticors', () => {
	it('returns 400 when url param is missing', async () => {
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.send).toHaveBeenCalledWith('Bad request: Missing `url` query param');
	});

	it('rejects invalid urls', async () => {
		const req = createMockRequest({ query: { url: '::not-a-url' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.send).toHaveBeenCalledWith('Bad request: Invalid `url` query param');
	});

	it('rejects disallowed hosts', async () => {
		const req = createMockRequest({ query: { url: 'https://example.com/file' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.send).toHaveBeenCalledWith('Host is not allowed');
	});

	it('handles OPTIONS preflight requests', async () => {
		const req = createMockRequest({
			method: 'OPTIONS',
			query: { url: 'https://api.real-debrid.com/test' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('proxies requests to allowed hosts', async () => {
		const upstreamResponse = new Response(JSON.stringify({ ok: true }), {
			status: 201,
			headers: {
				'content-type': 'application/json',
				'x-total-count': '1',
			},
		});
		const fetchMock = global.fetch as unknown as Mock;
		fetchMock.mockResolvedValue(upstreamResponse);

		const req = createMockRequest({
			method: 'GET',
			query: {
				url: 'https://api.real-debrid.com/resource',
				extra: 'tick',
			},
			headers: {
				origin: 'http://localhost:3000',
				authorization: 'Bearer abc',
				'content-type': 'application/json',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining('https://api.real-debrid.com/resource?t='),
			expect.objectContaining({
				method: 'GET',
				headers: {
					authorization: 'Bearer abc',
					'content-type': 'application/json',
				},
				body: undefined,
			})
		);
		expect(res.status).toHaveBeenCalledWith(201);
		expect(res.send).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
	});

	it('returns 500 when request body cannot be parsed', async () => {
		const req = asAsyncIterable(
			createMockRequest({
				method: 'POST',
				query: { url: 'https://api.real-debrid.com/submit' },
				headers: {
					'content-type': 'application/json',
				},
			}),
			['{invalid-json']
		);
		const res = createMockResponse();

		await handler(req as any, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.send).toHaveBeenCalledWith('Failed to read request body');
	});

	it('handles upstream failures', async () => {
		const fetchMock = global.fetch as unknown as Mock;
		fetchMock.mockRejectedValue(new Error('network'));

		const req = createMockRequest({
			method: 'GET',
			query: {
				url: 'https://api.real-debrid.com/resource',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.send).toHaveBeenCalledWith('Error fetching the proxy URL: network');
	});

	// The proxy is the only place browser-side debrid traffic is observable, so
	// `/is-torbox-down-or-just-me` and `/is-real-debrid-down-or-just-me` both
	// depend on it counting what upstream actually returned.
	describe('operation recording', () => {
		it('records a proxied TorBox call against the TorBox counters', async () => {
			const fetchMock = global.fetch as unknown as Mock;
			fetchMock.mockResolvedValue(
				new Response(JSON.stringify({ success: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				})
			);

			const req = createMockRequest({
				method: 'GET',
				query: { url: 'https://api.torbox.app/v1/api/torrents/mylist' },
			});
			const res = createMockResponse();

			await handler(req, res);

			expect(recordTorBoxOperationEvent).toHaveBeenCalledWith('GET /torrents/mylist', 200);
			expect(recordRdOperationEvent).not.toHaveBeenCalled();
		});

		it('records an upstream server error from TorBox', async () => {
			const fetchMock = global.fetch as unknown as Mock;
			fetchMock.mockResolvedValue(
				new Response('upstream is unwell', {
					status: 502,
					headers: { 'content-type': 'text/plain' },
				})
			);

			const req = createMockRequest({
				method: 'GET',
				query: { url: 'https://api.torbox.app/v1/api/user/me' },
			});
			const res = createMockResponse();

			await handler(req, res);

			expect(recordTorBoxOperationEvent).toHaveBeenCalledWith('GET /user/me', 502);
		});

		it('records a proxy-side failure as a 500', async () => {
			const fetchMock = global.fetch as unknown as Mock;
			fetchMock.mockRejectedValue(new Error('network'));

			const req = createMockRequest({
				method: 'GET',
				query: { url: 'https://api.torbox.app/v1/api/torrents/mylist' },
			});
			const res = createMockResponse();

			await handler(req, res);

			expect(recordTorBoxOperationEvent).toHaveBeenCalledWith('GET /torrents/mylist', 500);
		});

		it('leaves the TorBox counters alone for a Real-Debrid call', async () => {
			const fetchMock = global.fetch as unknown as Mock;
			fetchMock.mockResolvedValue(
				new Response('[]', {
					status: 200,
					headers: { 'content-type': 'application/json' },
				})
			);

			const req = createMockRequest({
				method: 'GET',
				query: { url: 'https://app.real-debrid.com/rest/1.0/torrents' },
			});
			const res = createMockResponse();

			await handler(req, res);

			expect(recordRdOperationEvent).toHaveBeenCalledWith('GET /torrents', 200);
			expect(recordTorBoxOperationEvent).not.toHaveBeenCalled();
		});

		it('does not record an unmonitored TorBox endpoint', async () => {
			const fetchMock = global.fetch as unknown as Mock;
			fetchMock.mockResolvedValue(
				new Response('{}', {
					status: 200,
					headers: { 'content-type': 'application/json' },
				})
			);

			const req = createMockRequest({
				method: 'GET',
				query: { url: 'https://api.torbox.app/v1/api/stats' },
			});
			const res = createMockResponse();

			await handler(req, res);

			expect(recordTorBoxOperationEvent).not.toHaveBeenCalled();
		});
	});

	// TorBox's createtorrent posts a .torrent file inside a multipart body.
	// Round-tripping that through utf-8 corrupts every byte above 0x7f.
	it('forwards a multipart body byte-for-byte', async () => {
		const fetchMock = global.fetch as unknown as Mock;
		fetchMock.mockResolvedValue(
			new Response('{}', {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		);

		const binaryBody = Buffer.from([
			0x2d, 0x2d, 0x62, 0x0d, 0x0a, 0xd8, 0x00, 0xff, 0xfe, 0x80, 0x0d, 0x0a,
		]);

		const req = asAsyncIterable(
			createMockRequest({
				method: 'POST',
				query: { url: 'https://api.torbox.app/v1/api/torrents/createtorrent' },
				headers: { 'content-type': 'multipart/form-data; boundary=b' },
			}),
			[binaryBody]
		);
		const res = createMockResponse();

		await handler(req as any, res);

		const sentBody = (global.fetch as unknown as Mock).mock.calls[0][1].body;
		expect(Buffer.isBuffer(sentBody)).toBe(true);
		expect(Buffer.compare(sentBody as Buffer, binaryBody)).toBe(0);
		expect(recordTorBoxOperationEvent).toHaveBeenCalledWith(
			'POST /torrents/createtorrent',
			200
		);
	});

	it('still forwards a urlencoded body as text', async () => {
		const fetchMock = global.fetch as unknown as Mock;
		fetchMock.mockResolvedValue(
			new Response('{}', {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		);

		const req = asAsyncIterable(
			createMockRequest({
				method: 'POST',
				query: { url: 'https://api.real-debrid.com/rest/1.0/torrents/addMagnet' },
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
			}),
			['magnet=abc']
		);
		const res = createMockResponse();

		await handler(req as any, res);

		expect((global.fetch as unknown as Mock).mock.calls[0][1].body).toBe('magnet=abc');
	});
});
