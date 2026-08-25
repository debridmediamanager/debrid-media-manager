import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	__testing,
	fetchCdnNodes,
	fetchServiceStats,
	isTorBoxHealthCheckInProgress,
	pingApi,
	testCdnNode,
} from './torboxHealth';

vi.mock('@/services/repository', () => ({
	repository: {
		upsertTorBoxCdnResults: vi.fn().mockResolvedValue(undefined),
		deleteDeprecatedTorBoxNodes: vi.fn().mockResolvedValue(0),
		recordTorBoxCheckResult: vi.fn().mockResolvedValue(undefined),
		recordTorBoxHealthSnapshot: vi.fn().mockResolvedValue(undefined),
	},
}));

const { repository } = await import('@/services/repository');

function jsonResponse(status: number, body: unknown) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
		headers: { get: () => null },
	} as unknown as Response;
}

function rangeResponse(status: number) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.reject(new Error('not json')),
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
		headers: { get: () => null },
	} as unknown as Response;
}

const SPEEDTEST_BODY = {
	success: true,
	error: null,
	detail: 'Successfully retrieved test files for speed test.',
	data: [
		{
			region: 'ceur',
			name: 'nexus-067',
			domain: 'https://nexus-067.ceur.tb-cdn.st',
			url: 'https://nexus-067.ceur.tb-cdn.st/dld/100MB.bin',
			closest: true,
		},
		{
			region: 'japn',
			name: 'nexus-115',
			domain: 'https://nexus-115.japn.tb-cdn.pw',
			url: 'https://nexus-115.japn.tb-cdn.pw/dld/100MB.bin',
			closest: false,
		},
	],
};

describe('torboxHealth', () => {
	beforeEach(() => {
		__testing.reset();
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	afterEach(() => {
		__testing.reset();
	});

	describe('pingApi', () => {
		it('reports the API up and keeps the detail string', async () => {
			vi.stubGlobal(
				'fetch',
				vi
					.fn()
					.mockResolvedValue(
						jsonResponse(200, { success: true, error: null, detail: 'API is running.' })
					)
			);

			const result = await pingApi();

			expect(result.ok).toBe(true);
			expect(result.detail).toBe('API is running.');
			expect(result.error).toBeNull();
		});

		// TorBox reports application failures as HTTP 200 with success:false,
		// so response.ok alone would wrongly call this a healthy API.
		it('treats HTTP 200 with success:false as a failure', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(
					jsonResponse(200, {
						success: false,
						error: 'DATABASE_ERROR',
						detail: 'Something broke',
					})
				)
			);

			const result = await pingApi();

			expect(result.ok).toBe(false);
			expect(result.error).toBe('DATABASE_ERROR: Something broke');
		});

		it('reports a network failure as down', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

			const result = await pingApi();

			expect(result.ok).toBe(false);
			expect(result.error).toBe('ECONNREFUSED');
		});
	});

	describe('fetchServiceStats', () => {
		it('reads the public counters', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(
					jsonResponse(200, {
						success: true,
						data: { total_users: 944281, total_servers: 212 },
					})
				)
			);

			await expect(fetchServiceStats()).resolves.toEqual({
				totalUsers: 944281,
				totalServers: 212,
			});
		});

		it('degrades to null when the endpoint fails', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(jsonResponse(500, { success: false }))
			);

			await expect(fetchServiceStats()).resolves.toBeNull();
		});
	});

	describe('fetchCdnNodes', () => {
		it('derives the host from each advertised URL', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, SPEEDTEST_BODY)));

			const nodes = await fetchCdnNodes();

			expect(nodes).toHaveLength(2);
			expect(nodes[0]).toEqual({
				host: 'nexus-067.ceur.tb-cdn.st',
				region: 'ceur',
				name: 'nexus-067',
				url: 'https://nexus-067.ceur.tb-cdn.st/dld/100MB.bin',
			});
		});

		it('keeps one node per region', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(
					jsonResponse(200, {
						success: true,
						data: [
							...SPEEDTEST_BODY.data,
							{
								region: 'ceur',
								name: 'nexus-999',
								url: 'https://nexus-999.ceur.tb-cdn.st/dld/100MB.bin',
							},
						],
					})
				)
			);

			const nodes = await fetchCdnNodes();

			expect(nodes.map((n) => n.region)).toEqual(['ceur', 'japn']);
			expect(nodes[0].name).toBe('nexus-067');
		});

		it('skips entries with an unparseable URL', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(
					jsonResponse(200, {
						success: true,
						data: [{ region: 'ceur', name: 'broken', url: 'not-a-url' }],
					})
				)
			);

			await expect(fetchCdnNodes()).resolves.toEqual([]);
		});

		it('returns an empty list when discovery fails', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

			await expect(fetchCdnNodes()).resolves.toEqual([]);
		});
	});

	describe('testCdnNode', () => {
		const node = {
			host: 'nexus-067.ceur.tb-cdn.st',
			region: 'ceur',
			name: 'nexus-067',
			url: 'https://nexus-067.ceur.tb-cdn.st/dld/100MB.bin',
		};

		it('passes only on a 206 partial response', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rangeResponse(206)));

			const result = await testCdnNode(node);

			expect(result.ok).toBe(true);
			expect(result.status).toBe(206);
			expect(result.latencyMs).not.toBeNull();
		});

		// A 200 means the node ignored Range and would have sent the whole
		// 100MB file - that is a broken byte path, not a healthy one.
		it('fails a 200 that ignored the Range header', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rangeResponse(200)));

			const result = await testCdnNode(node);

			expect(result.ok).toBe(false);
			expect(result.error).toBe('HTTP 200 (Range ignored)');
			expect(result.latencyMs).toBeNull();
		});

		it('fails on a server error', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rangeResponse(503)));

			const result = await testCdnNode(node);

			expect(result.ok).toBe(false);
			expect(result.error).toBe('HTTP 503');
		});

		it('records the region and name even when the node is unreachable', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));

			const result = await testCdnNode(node);

			expect(result).toMatchObject({
				host: node.host,
				region: 'ceur',
				name: 'nexus-067',
				ok: false,
				error: 'ETIMEDOUT',
			});
		});
	});

	describe('executeCheck', () => {
		it('stores node statuses and a check result', async () => {
			const fetchMock = vi.fn(async (input: unknown) => {
				const url = String(input);
				if (url.endsWith('/')) {
					return jsonResponse(200, { success: true, detail: 'API is running.' });
				}
				if (url.includes('speedtest')) {
					return jsonResponse(200, SPEEDTEST_BODY);
				}
				return rangeResponse(206);
			});
			vi.stubGlobal('fetch', fetchMock);

			await __testing.executeCheck();

			expect(repository.deleteDeprecatedTorBoxNodes).toHaveBeenCalledWith([
				'nexus-067.ceur.tb-cdn.st',
				'nexus-115.japn.tb-cdn.pw',
			]);
			expect(repository.upsertTorBoxCdnResults).toHaveBeenCalledOnce();
			expect(repository.recordTorBoxCheckResult).toHaveBeenCalledWith(
				expect.objectContaining({
					apiOk: true,
					totalNodes: 2,
					workingNodes: 2,
				})
			);
			expect(repository.recordTorBoxHealthSnapshot).toHaveBeenCalledWith(
				expect.objectContaining({ totalNodes: 2, workingNodes: 2, apiOk: true })
			);
		});

		// The authenticated probe was removed deliberately: it spent the
		// operator's TorBox key every 5 minutes and never affected the verdict.
		// Nothing in a health check may touch an authenticated endpoint.
		it('never calls an authenticated endpoint', async () => {
			const fetchMock = vi.fn(async (input: unknown, _init?: unknown) => {
				const url = String(input);
				if (url.endsWith('/')) {
					return jsonResponse(200, { success: true, detail: 'API is running.' });
				}
				if (url.includes('speedtest')) {
					return jsonResponse(200, SPEEDTEST_BODY);
				}
				return rangeResponse(206);
			});
			vi.stubGlobal('fetch', fetchMock);

			await __testing.executeCheck();

			const urls = fetchMock.mock.calls.map((call) => String(call[0]));
			expect(urls.some((u) => u.includes('/user/me'))).toBe(false);
			expect(urls.some((u) => u.includes('checkcached'))).toBe(false);

			const sentAuthHeader = fetchMock.mock.calls.some((call) => {
				const init = call[1] as { headers?: Record<string, string> } | undefined;
				return Boolean(init?.headers?.Authorization);
			});
			expect(sentAuthHeader).toBe(false);
		});

		// Losing the node list must not wipe the table: an empty table would
		// render as a total outage on the page.
		it('keeps previous node statuses when discovery returns nothing', async () => {
			const fetchMock = vi.fn(async (input: unknown) => {
				const url = String(input);
				if (url.includes('speedtest')) {
					return jsonResponse(500, { success: false, error: 'UNKNOWN_ERROR' });
				}
				return jsonResponse(200, { success: true, detail: 'API is running.' });
			});
			vi.stubGlobal('fetch', fetchMock);

			await __testing.executeCheck();

			expect(repository.deleteDeprecatedTorBoxNodes).not.toHaveBeenCalled();
			expect(repository.upsertTorBoxCdnResults).not.toHaveBeenCalled();
			expect(repository.recordTorBoxHealthSnapshot).not.toHaveBeenCalled();
			// The run still leaves a trace, so the page can age its freshness.
			expect(repository.recordTorBoxCheckResult).toHaveBeenCalledWith(
				expect.objectContaining({ totalNodes: 0, workingNodes: 0 })
			);
		});

		it('records a failing API without throwing', async () => {
			const fetchMock = vi.fn(async (input: unknown) => {
				const url = String(input);
				if (url.includes('speedtest')) return jsonResponse(200, SPEEDTEST_BODY);
				if (url.endsWith('/')) throw new Error('ECONNREFUSED');
				return rangeResponse(206);
			});
			vi.stubGlobal('fetch', fetchMock);

			await __testing.executeCheck();

			expect(repository.recordTorBoxCheckResult).toHaveBeenCalledWith(
				expect.objectContaining({ apiOk: false, apiDetail: 'ECONNREFUSED' })
			);
		});

		it('is not marked in progress once finished', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: [] }))
			);

			await __testing.executeCheck();

			expect(isTorBoxHealthCheckInProgress()).toBe(false);
		});
	});
});
