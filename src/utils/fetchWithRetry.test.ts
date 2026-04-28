import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/delay', () => ({
	delay: vi.fn().mockResolvedValue(undefined),
}));

import { delay } from '@/utils/delay';
import { fetchJsonWithRetry, fetchWithRetry } from './fetchWithRetry';

function mockResponse(status: number, body: any = {}, headers: Record<string, string> = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: {
			get: (name: string) => headers[name] ?? null,
		},
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
	} as unknown as Response;
}

describe('fetchWithRetry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn());
	});

	it('returns response immediately on success', async () => {
		vi.mocked(fetch).mockResolvedValue(mockResponse(200, { ok: true }));

		const resp = await fetchWithRetry('https://example.com');

		expect(resp.status).toBe(200);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(delay).not.toHaveBeenCalled();
	});

	it('returns response immediately on non-retryable 4xx error', async () => {
		vi.mocked(fetch).mockResolvedValue(mockResponse(404));

		const resp = await fetchWithRetry('https://example.com');

		expect(resp.status).toBe(404);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(delay).not.toHaveBeenCalled();
	});

	it('retries on 429 status', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(mockResponse(429))
			.mockResolvedValueOnce(mockResponse(200));

		const resp = await fetchWithRetry('https://example.com');

		expect(resp.status).toBe(200);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(delay).toHaveBeenCalledTimes(1);
	});

	it('retries on 5xx status', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(mockResponse(503))
			.mockResolvedValueOnce(mockResponse(200));

		const resp = await fetchWithRetry('https://example.com');

		expect(resp.status).toBe(200);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(delay).toHaveBeenCalledTimes(1);
	});

	it('respects Retry-After header', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(mockResponse(429, {}, { 'Retry-After': '3' }))
			.mockResolvedValueOnce(mockResponse(200));

		await fetchWithRetry('https://example.com');

		expect(delay).toHaveBeenCalledWith(3000);
	});

	it('gives up after maxRetries and returns the error response', async () => {
		vi.mocked(fetch).mockResolvedValue(mockResponse(500));

		const resp = await fetchWithRetry('https://example.com', { maxRetries: 2 });

		expect(resp.status).toBe(500);
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(delay).toHaveBeenCalledTimes(2);
	});

	it('retries on network error (fetch throws)', async () => {
		vi.mocked(fetch)
			.mockRejectedValueOnce(new Error('Network failure'))
			.mockResolvedValueOnce(mockResponse(200));

		const resp = await fetchWithRetry('https://example.com');

		expect(resp.status).toBe(200);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(delay).toHaveBeenCalledTimes(1);
	});

	it('throws after maxRetries on persistent network error', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('Network failure'));

		await expect(fetchWithRetry('https://example.com', { maxRetries: 1 })).rejects.toThrow(
			'Network failure'
		);

		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('uses custom maxRetries option', async () => {
		vi.mocked(fetch).mockResolvedValue(mockResponse(500));

		await fetchWithRetry('https://example.com', { maxRetries: 3 });

		expect(fetch).toHaveBeenCalledTimes(4);
		expect(delay).toHaveBeenCalledTimes(3);
	});
});

describe('fetchJsonWithRetry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn());
	});

	it('parses JSON response on success', async () => {
		vi.mocked(fetch).mockResolvedValue(mockResponse(200, { name: 'test' }));

		const data = await fetchJsonWithRetry<{ name: string }>('https://example.com');

		expect(data).toEqual({ name: 'test' });
	});

	it('throws on non-ok response', async () => {
		vi.mocked(fetch).mockResolvedValue(mockResponse(400, 'Bad Request'));

		await expect(fetchJsonWithRetry('https://example.com')).rejects.toThrow('HTTP 400');
	});

	it('retries on 5xx then parses successful response', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(mockResponse(502))
			.mockResolvedValueOnce(mockResponse(200, { result: 'ok' }));

		const data = await fetchJsonWithRetry<{ result: string }>('https://example.com');

		expect(data).toEqual({ result: 'ok' });
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
