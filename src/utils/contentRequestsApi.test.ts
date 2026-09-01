import {
	cancelContentRequest,
	fetchContentRequests,
	fileContentRequest,
	fulfillContentRequest,
	RD_TOKEN_HEADER,
} from '@/utils/contentRequestsApi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

const lastCall = () => (global.fetch as any).mock.calls.at(-1);
const lastInit = () => lastCall()[1] ?? {};

beforeEach(() => {
	global.fetch = vi.fn() as any;
});

describe('fetchContentRequests', () => {
	it('sends the key as a header, never in the URL', async () => {
		(global.fetch as any).mockResolvedValue(ok({ requests: [], authenticated: true }));
		await fetchContentRequests('RD_TOKEN');
		const [url, init] = lastCall();
		// nginx logs the request line, so a key in the URL is a key on disk forever.
		expect(url).toBe('/api/requests');
		expect(String(url)).not.toContain('RD_TOKEN');
		expect(init.headers[RD_TOKEN_HEADER]).toBe('RD_TOKEN');
	});

	it('reads the board signed out, sending no auth header at all', async () => {
		(global.fetch as any).mockResolvedValue(ok({ requests: [], authenticated: false }));
		const result = await fetchContentRequests(null);
		expect(lastInit().headers[RD_TOKEN_HEADER]).toBeUndefined();
		expect(result.authenticated).toBe(false);
	});

	it('survives a body that is not the shape it expects', async () => {
		(global.fetch as any).mockResolvedValue(ok({ requests: 'nope' }));
		expect(await fetchContentRequests(null)).toEqual({
			requests: [],
			authenticated: false,
			hasMore: false,
		});
	});

	it('passes offset and limit as query params, keeping the key in the header', async () => {
		(global.fetch as any).mockResolvedValue(
			ok({ requests: [], authenticated: true, hasMore: true })
		);
		const result = await fetchContentRequests('RD_TOKEN', { offset: 25, limit: 25 });
		const [url, init] = lastCall();
		expect(url).toBe('/api/requests?offset=25&limit=25');
		expect(String(url)).not.toContain('RD_TOKEN');
		expect(init.headers[RD_TOKEN_HEADER]).toBe('RD_TOKEN');
		expect(result.hasMore).toBe(true);
	});

	it('omits a zero offset from the query', async () => {
		(global.fetch as any).mockResolvedValue(
			ok({ requests: [], authenticated: false, hasMore: false })
		);
		await fetchContentRequests(null, { offset: 0, limit: 25 });
		expect(lastCall()[0]).toBe('/api/requests?limit=25');
	});

	it('raises the server’s own message rather than the status', async () => {
		(global.fetch as any).mockResolvedValue(fail(500, { error: 'Failed to list requests' }));
		await expect(fetchContentRequests(null)).rejects.toThrow('Failed to list requests');
	});

	it('falls back to the status when there is no message', async () => {
		(global.fetch as any).mockResolvedValue({
			ok: false,
			status: 502,
			json: async () => {
				throw new Error('not json');
			},
		});
		await expect(fetchContentRequests(null)).rejects.toThrow('502');
	});
});

describe('fileContentRequest', () => {
	it('posts the release as JSON', async () => {
		(global.fetch as any).mockResolvedValue(ok({ request: { id: 'req-1' } }));
		const row = await fileContentRequest('RD', {
			hash: 'abc',
			imdbId: 'tt1234567',
			title: 'Some Release',
			mediaType: 'movie',
		});
		const init = lastInit();
		expect(init.method).toBe('POST');
		expect(init.headers['Content-Type']).toBe('application/json');
		expect(JSON.parse(init.body)).toEqual({
			hash: 'abc',
			imdbId: 'tt1234567',
			title: 'Some Release',
			mediaType: 'movie',
		});
		expect(row).toEqual({ id: 'req-1' });
	});
});

describe('fulfillContentRequest', () => {
	it('sends only the keys the fulfiller actually holds', async () => {
		(global.fetch as any).mockResolvedValue(ok({ jobId: 'job-9' }));
		const jobId = await fulfillContentRequest('RD', 'req-1', { tbKey: 'TB' });
		expect(JSON.parse(lastInit().body)).toEqual({ tbKey: 'TB' });
		expect(jobId).toBe('job-9');
	});

	it('escapes the id into the path', async () => {
		(global.fetch as any).mockResolvedValue(ok({ jobId: 'j' }));
		await fulfillContentRequest('RD', 'a/b', { tbKey: 'TB' });
		expect(lastCall()[0]).toBe('/api/requests/a%2Fb/fulfill');
	});

	it('surfaces the lost-the-race message, which is the whole point of the 409', async () => {
		(global.fetch as any).mockResolvedValue(
			fail(409, { error: 'somebody else just took this request' })
		);
		await expect(fulfillContentRequest('RD', 'req-1', { tbKey: 'TB' })).rejects.toThrow(
			'somebody else just took this request'
		);
	});
});

describe('cancelContentRequest', () => {
	it('deletes with the key as a header', async () => {
		(global.fetch as any).mockResolvedValue(ok({ cancelled: true }));
		await cancelContentRequest('RD', 'req-1');
		const [url, init] = lastCall();
		expect(url).toBe('/api/requests/req-1');
		expect(init.method).toBe('DELETE');
		expect(init.headers[RD_TOKEN_HEADER]).toBe('RD');
	});

	it('raises when the row was not the caller’s', async () => {
		(global.fetch as any).mockResolvedValue(
			fail(409, { error: 'that request is not yours to cancel' })
		);
		await expect(cancelContentRequest('RD', 'req-1')).rejects.toThrow('not yours');
	});
});
