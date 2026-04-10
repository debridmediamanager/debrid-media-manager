import handler from '@/pages/api/anticors';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
