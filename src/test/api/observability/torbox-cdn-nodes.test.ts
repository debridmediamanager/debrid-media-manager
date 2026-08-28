import handler, { __testing } from '@/pages/api/observability/torbox-cdn-nodes';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type GlobalWithFetch = typeof globalThis & { fetch?: typeof fetch };
const globalWithFetch = globalThis as GlobalWithFetch;
const originalFetch = globalWithFetch.fetch;

const ENVELOPE = {
	success: true,
	data: [
		{
			region: 'ceur',
			name: 'nexus-067',
			url: 'https://nexus-067.ceur.tb-cdn.st/dld/100MB.bin',
			closest: true,
		},
	],
};

function jsonResponse(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	} as unknown as Response;
}

beforeEach(() => {
	__testing.reset();
	vi.clearAllMocks();
});

afterEach(() => {
	if (originalFetch) {
		globalWithFetch.fetch = originalFetch;
	} else {
		Reflect.deleteProperty(globalWithFetch, 'fetch');
	}
});

describe('API /api/observability/torbox-cdn-nodes', () => {
	it('rejects non-GET requests', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
	});

	// The browser parses one shape whether it read the list here or straight
	// from TorBox, so this must not reshape the envelope.
	it('hands back TorBox envelope verbatim', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(jsonResponse(ENVELOPE)) as unknown as typeof fetch;
		const res = createMockResponse();

		await handler(createMockRequest({ method: 'GET' }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual(ENVELOPE);
		expect(globalWithFetch.fetch).toHaveBeenCalledWith(
			'https://api.torbox.app/v1/api/speedtest?test_length=short',
			expect.anything()
		);
	});

	// The probe this replaced hit TorBox ~5,500 times a day from one IP and got
	// rate-limited into announcing outages that were not happening.
	it('serves a second request from cache without calling TorBox again', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ENVELOPE));
		globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

		await handler(createMockRequest({ method: 'GET' }), createMockResponse());
		const second = createMockResponse();
		await handler(createMockRequest({ method: 'GET' }), second);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(second._getData()).toEqual(ENVELOPE);
	});

	// A stale list still names real hostnames, and the browser is what decides
	// whether they serve bytes.
	it('falls back to the last good list when TorBox goes away', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(ENVELOPE)) as unknown as typeof fetch;
		await handler(createMockRequest({ method: 'GET' }), createMockResponse());

		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(Date.now() + 11 * 60 * 1000);
		globalWithFetch.fetch = vi
			.fn()
			.mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'GET' }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual(ENVELOPE);
		vi.useRealTimers();
	});

	it('reports a bad gateway when there is nothing cached to fall back on', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(jsonResponse({}, 429)) as unknown as typeof fetch;
		const res = createMockResponse();

		await handler(createMockRequest({ method: 'GET' }), res);

		expect(res.status).toHaveBeenCalledWith(502);
		expect(res._getData()).toEqual({ error: 'Could not reach TorBox' });
	});
});
