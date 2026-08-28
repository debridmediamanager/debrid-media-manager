import {
	fetchCdnNodes,
	probeCdnNode,
	regionLabel,
	runCdnProbe,
	submitCdnProbe,
	type TorBoxCdnNode,
	type TorBoxCdnNodeResult,
} from '@/lib/observability/torboxCdnProbe';
import { afterEach, describe, expect, it, vi } from 'vitest';

type GlobalWithFetch = typeof globalThis & { fetch?: typeof fetch };
const globalWithFetch = globalThis as GlobalWithFetch;
const originalFetch = globalWithFetch.fetch;

function speedtestEntry(overrides: Record<string, unknown> = {}) {
	return {
		region: 'ceur',
		name: 'nexus-067',
		domain: 'https://nexus-067.ceur.tb-cdn.st',
		path: '/dld/100MB.bin',
		url: 'https://nexus-067.ceur.tb-cdn.st/dld/100MB.bin',
		closest: true,
		...overrides,
	};
}

function jsonResponse(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	} as unknown as Response;
}

function rangeResponse(status: number) {
	return {
		ok: status >= 200 && status < 300,
		status,
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
	} as unknown as Response;
}

function node(overrides: Partial<TorBoxCdnNode> = {}): TorBoxCdnNode {
	return {
		host: 'nexus-067.ceur.tb-cdn.st',
		region: 'ceur',
		name: 'nexus-067',
		url: 'https://nexus-067.ceur.tb-cdn.st/dld/100MB.bin',
		closest: true,
		...overrides,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	if (originalFetch) {
		globalWithFetch.fetch = originalFetch;
	} else {
		Reflect.deleteProperty(globalWithFetch, 'fetch');
	}
});

describe('regionLabel', () => {
	it('names known TorBox region codes', () => {
		expect(regionLabel('ceur')).toBe('Central Europe');
		expect(regionLabel('erth')).toBe('Anycast (Cloudflare)');
	});

	it('falls back to the uppercased code for a region TorBox has not shipped before', () => {
		expect(regionLabel('mars')).toBe('MARS');
	});
});

describe('fetchCdnNodes', () => {
	it('reads the advertised nodes and keeps TorBox ordering', async () => {
		globalWithFetch.fetch = vi.fn().mockResolvedValue(
			jsonResponse({
				success: true,
				data: [
					speedtestEntry(),
					speedtestEntry({
						region: 'enam',
						name: 'nexus-087',
						url: 'https://nexus-087.enam.tb-cdn.io/dld/100MB.bin',
						closest: false,
					}),
				],
			})
		) as unknown as typeof fetch;

		const { nodes, error } = await fetchCdnNodes();

		expect(error).toBeNull();
		expect(nodes.map((n) => n.region)).toEqual(['ceur', 'enam']);
		expect(nodes[0]).toMatchObject({ host: 'nexus-067.ceur.tb-cdn.st', closest: true });
		expect(nodes[1].closest).toBe(false);
	});

	it('keeps one node per region so a future multi-node response cannot double-count', async () => {
		globalWithFetch.fetch = vi.fn().mockResolvedValue(
			jsonResponse({
				success: true,
				data: [
					speedtestEntry(),
					speedtestEntry({
						name: 'nexus-999',
						url: 'https://nexus-999.ceur.tb-cdn.st/dld/100MB.bin',
					}),
				],
			})
		) as unknown as typeof fetch;

		const { nodes } = await fetchCdnNodes();

		expect(nodes).toHaveLength(1);
		expect(nodes[0].name).toBe('nexus-067');
	});

	it('drops entries with no url, no region or an unparseable url', async () => {
		globalWithFetch.fetch = vi.fn().mockResolvedValue(
			jsonResponse({
				success: true,
				data: [
					speedtestEntry(),
					{ region: 'weur' },
					{ url: 'https://nexus-068.weur.tb-cdn.st/dld/100MB.bin' },
					speedtestEntry({ region: 'neur', url: 'not a url' }),
				],
			})
		) as unknown as typeof fetch;

		const { nodes } = await fetchCdnNodes();

		expect(nodes.map((n) => n.region)).toEqual(['ceur']);
	});

	it('names the node after its host when TorBox omits a name', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ success: true, data: [speedtestEntry({ name: undefined })] })
			) as unknown as typeof fetch;

		const { nodes } = await fetchCdnNodes();

		expect(nodes[0].name).toBe('nexus-067');
	});

	// TorBox reports application failures as HTTP 200 with success:false, so a
	// status check alone would hand an error document back as a node list.
	it('treats success:false as an error even though the status is 200', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ success: false, error: 'AUTH_ERROR', detail: 'nope', data: [] })
			) as unknown as typeof fetch;

		const { nodes, error } = await fetchCdnNodes();

		expect(nodes).toEqual([]);
		expect(error).toBe('AUTH_ERROR');
	});

	it('falls back to detail, then to a generic message, when success:false carries no error string', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(jsonResponse({ success: false, detail: 'maintenance' }));
		await expect(fetchCdnNodes()).resolves.toMatchObject({ error: 'maintenance' });

		globalWithFetch.fetch = vi.fn().mockResolvedValue(jsonResponse({ success: false }));
		await expect(fetchCdnNodes()).resolves.toMatchObject({
			error: 'TorBox reported success:false',
		});
	});

	it('reports a non-2xx status', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(jsonResponse({}, 429)) as unknown as typeof fetch;

		await expect(fetchCdnNodes()).resolves.toEqual({ nodes: [], error: 'HTTP 429' });
	});

	it('reports an unexpected body shape', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ success: true, data: 'nope' })
			) as unknown as typeof fetch;

		await expect(fetchCdnNodes()).resolves.toEqual({
			nodes: [],
			error: 'Unexpected response shape',
		});
	});

	it('reports a network failure and a timeout distinctly', async () => {
		globalWithFetch.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(fetchCdnNodes()).resolves.toEqual({ nodes: [], error: 'Failed to fetch' });

		const abortError = new Error('aborted');
		abortError.name = 'AbortError';
		globalWithFetch.fetch = vi.fn().mockRejectedValue(abortError);
		await expect(fetchCdnNodes()).resolves.toEqual({ nodes: [], error: 'Timeout' });

		globalWithFetch.fetch = vi.fn().mockRejectedValue('not an error');
		await expect(fetchCdnNodes()).resolves.toEqual({ nodes: [], error: 'Unknown error' });
	});

	// TorBox's API CORS allowlist carries the production origin and localhost:3000
	// and refuses everything else, which the browser surfaces as a bare fetch
	// failure. Without the fallback the panel is dead on every self-hosted build.
	describe('falling back to DMM when TorBox refuses the origin', () => {
		it('reads the same list from DMM after a blocked direct request', async () => {
			const fetchMock = vi.fn().mockImplementation((url: string) => {
				if (url.startsWith('https://api.torbox.app/')) {
					return Promise.reject(new TypeError('Failed to fetch'));
				}
				return Promise.resolve(jsonResponse({ success: true, data: [speedtestEntry()] }));
			});
			globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

			const { nodes, error } = await fetchCdnNodes();

			expect(error).toBeNull();
			expect(nodes.map((n) => n.region)).toEqual(['ceur']);
			expect(String(fetchMock.mock.calls[1][0])).toBe('/api/observability/torbox-cdn-nodes');
		});

		it('does not touch DMM when TorBox answers directly', async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(jsonResponse({ success: true, data: [speedtestEntry()] }));
			globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

			await fetchCdnNodes();

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(String(fetchMock.mock.calls[0][0])).toContain('api.torbox.app');
		});

		// An empty list is TorBox answering, not TorBox refusing. Falling back
		// there would hit DMM on every pageview for nothing.
		it('does not fall back on an empty but successful list', async () => {
			const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }));
			globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

			await expect(fetchCdnNodes()).resolves.toEqual({ nodes: [], error: null });
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('keeps TorBox own error when the fallback fails too', async () => {
			globalWithFetch.fetch = vi
				.fn()
				.mockImplementation((url: string) =>
					url.startsWith('https://api.torbox.app/')
						? Promise.resolve(jsonResponse({}, 429))
						: Promise.resolve(jsonResponse({}, 502))
				) as unknown as typeof fetch;

			await expect(fetchCdnNodes()).resolves.toEqual({ nodes: [], error: 'HTTP 429' });
		});
	});

	it('aborts when the caller aborts', async () => {
		const controller = new AbortController();
		globalWithFetch.fetch = vi.fn().mockImplementation(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => {
						const error = new Error('aborted');
						error.name = 'AbortError';
						reject(error);
					});
				})
		) as unknown as typeof fetch;

		const pending = fetchCdnNodes(controller.signal);
		controller.abort();

		await expect(pending).resolves.toEqual({ nodes: [], error: 'Timeout' });
	});
});

describe('probeCdnNode', () => {
	it('passes a node that answers 206 and records its latency', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(rangeResponse(206)) as unknown as typeof fetch;

		const result = await probeCdnNode(node());

		expect(result.ok).toBe(true);
		expect(result.status).toBe(206);
		expect(result.latencyMs).not.toBeNull();
		expect(result.error).toBeNull();
		expect(globalWithFetch.fetch).toHaveBeenCalledWith(
			'https://nexus-067.ceur.tb-cdn.st/dld/100MB.bin',
			expect.objectContaining({ headers: { Range: 'bytes=0-0' } })
		);
	});

	// A 200 means the node ignored Range and was about to send the whole 100MB
	// test file, which is not the same thing as serving a byte range correctly.
	it('fails a node that ignores Range and answers 200', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(rangeResponse(200)) as unknown as typeof fetch;

		const result = await probeCdnNode(node());

		expect(result.ok).toBe(false);
		expect(result.error).toBe('HTTP 200 (Range ignored)');
		expect(result.latencyMs).toBeNull();
	});

	it('fails a node that refuses, keeping the status', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(rangeResponse(503)) as unknown as typeof fetch;

		await expect(probeCdnNode(node())).resolves.toMatchObject({
			ok: false,
			status: 503,
			error: 'HTTP 503',
		});
	});

	it('fails a node the browser cannot reach at all', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

		await expect(probeCdnNode(node())).resolves.toMatchObject({
			ok: false,
			status: null,
			latencyMs: null,
			error: 'Failed to fetch',
		});
	});

	it('still passes when the body cannot be drained', async () => {
		globalWithFetch.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 206,
			arrayBuffer: () => Promise.reject(new Error('stream broke')),
		}) as unknown as typeof fetch;

		await expect(probeCdnNode(node())).resolves.toMatchObject({ ok: true, status: 206 });
	});
});

describe('runCdnProbe', () => {
	it('probes every advertised region', async () => {
		globalWithFetch.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.startsWith('https://api.torbox.app/')) {
				return Promise.resolve(
					jsonResponse({
						success: true,
						data: [
							speedtestEntry(),
							speedtestEntry({
								region: 'enam',
								url: 'https://nexus-087.enam.tb-cdn.io/dld/100MB.bin',
								closest: false,
							}),
						],
					})
				);
			}
			return Promise.resolve(rangeResponse(url.includes('enam') ? 502 : 206));
		}) as unknown as typeof fetch;

		const result = await runCdnProbe();

		expect(result.discoveryError).toBeNull();
		expect(result.nodes.map((n) => [n.region, n.ok])).toEqual([
			['ceur', true],
			['enam', false],
		]);
		expect(result.checkedAt).toBeGreaterThan(0);
	});

	it('reports the discovery failure rather than an empty-but-healthy result', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(jsonResponse({}, 500)) as unknown as typeof fetch;

		const result = await runCdnProbe();

		expect(result.nodes).toEqual([]);
		expect(result.discoveryError).toBe('HTTP 500');
	});

	it('reports an empty node list as a discovery failure', async () => {
		globalWithFetch.fetch = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ success: true, data: [] })
			) as unknown as typeof fetch;

		await expect(runCdnProbe()).resolves.toMatchObject({
			discoveryError: 'TorBox advertised no CDN nodes',
		});
	});
});

describe('submitCdnProbe', () => {
	function nodeResult(overrides: Partial<TorBoxCdnNodeResult> = {}): TorBoxCdnNodeResult {
		return { ...node(), ok: true, status: 206, latencyMs: 42, error: null, ...overrides };
	}

	it('posts one entry per probed region', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
		globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			submitCdnProbe({
				nodes: [
					nodeResult(),
					nodeResult({ region: 'enam', ok: false, status: 502, latencyMs: null }),
				],
				discoveryError: null,
				checkedAt: Date.now(),
			})
		).resolves.toBe(true);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/observability/torbox-cdn');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({
			results: [
				{ region: 'ceur', ok: true, latencyMs: 42 },
				{ region: 'enam', ok: false, latencyMs: null },
			],
		});
	});

	// A failure has no latency to report, and sending the node's stale one would
	// let a dark region contribute to a healthy one's average.
	it('sends no latency for a region that did not serve bytes', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
		globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

		await submitCdnProbe({
			nodes: [nodeResult({ ok: false, latencyMs: 8000 })],
			discoveryError: null,
			checkedAt: Date.now(),
		});

		expect(JSON.parse(fetchMock.mock.calls[0][1].body).results[0].latencyMs).toBeNull();
	});

	it('sends nothing when there was nothing to measure', async () => {
		const fetchMock = vi.fn();
		globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			submitCdnProbe({ nodes: [], discoveryError: 'HTTP 429', checkedAt: Date.now() })
		).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// The reader came for a status page. A rejected or rate-limited vote must
	// never surface as a broken panel.
	it('swallows a refused or unreachable endpoint', async () => {
		globalWithFetch.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
		await expect(
			submitCdnProbe({ nodes: [nodeResult()], discoveryError: null, checkedAt: 1 })
		).resolves.toBe(false);

		globalWithFetch.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(
			submitCdnProbe({ nodes: [nodeResult()], discoveryError: null, checkedAt: 1 })
		).resolves.toBe(false);
	});
});
