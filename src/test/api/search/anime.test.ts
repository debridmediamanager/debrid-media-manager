import addonFateZero from '@/test/fixtures/anime/addon-search-fate-zero.json';
import kitsuNoMatch from '@/test/fixtures/anime/kitsu-search-zzqqxxnotananime.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { readFileSync } from 'fs';
import path from 'path';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addonBlockPage = readFileSync(
	path.resolve(__dirname, '../../fixtures/anime/addon-search-zzqqxxnotananime-403.html'),
	'utf8'
);

const mockGetAnimeByKitsuIds = vi.fn();

vi.mock('@/services/repository', () => ({
	repository: {
		getAnimeByKitsuIds: mockGetAnimeByKitsuIds,
	},
}));

describe('/api/search/anime', () => {
	const originalFetch = global.fetch;

	const loadHandler = async () => {
		const mod = await import('@/pages/api/search/anime');
		return mod.default;
	};

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		global.fetch = vi.fn();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('returns 400 when keyword query param is missing', async () => {
		const handler = await loadHandler();
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "keyword" query parameter',
		});
		expect(mockGetAnimeByKitsuIds).not.toHaveBeenCalled();
	});

	it('fetches kitsu ids, caches them, and responds with repository results', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { keyword: 'One Piece' } });
		const res = createMockResponse();
		const res2 = createMockResponse();

		const fetchMock = global.fetch as unknown as Mock;
		const fetchResponse = {
			metas: [{ id: 'kitsu:1' }, { id: 'kitsu:2' }],
		};

		fetchMock.mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue(fetchResponse),
		});
		mockGetAnimeByKitsuIds.mockResolvedValue([{ title: 'Anime' }]);

		await handler(req, res);

		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(global.fetch).toHaveBeenCalledWith(
			'https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-list/search=one%20piece.json'
		);
		expect(mockGetAnimeByKitsuIds).toHaveBeenCalledWith([1, 2]);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: [{ title: 'Anime' }] });

		fetchMock.mockClear();
		mockGetAnimeByKitsuIds.mockResolvedValue([{ title: 'Cached' }]);

		await handler(req, res2);

		expect(global.fetch).not.toHaveBeenCalled();
		expect(mockGetAnimeByKitsuIds).toHaveBeenCalledWith([1, 2]);
		expect(res2.json).toHaveBeenCalledWith({ results: [{ title: 'Cached' }] });
	});

	it('handles upstream failures by logging and returning 500', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { keyword: 'Naruto' } });
		const res = createMockResponse();
		const fetchMock = global.fetch as unknown as Mock;
		// Both the addon and the Kitsu fallback are unreachable.
		fetchMock.mockRejectedValue(new Error('network down'));

		await handler(req, res);

		expect(global.fetch).toHaveBeenCalledTimes(2);
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'An error occurred while fetching the data',
		});
	});

	it('falls back to the official Kitsu API when the addon is down', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { keyword: 'Bebop' } });
		const res = createMockResponse();
		const fetchMock = global.fetch as unknown as Mock;

		fetchMock.mockRejectedValueOnce(new Error('addon down')).mockResolvedValueOnce({
			ok: true,
			json: vi.fn().mockResolvedValue({ data: [{ id: '1' }, { id: '2' }] }),
		});
		mockGetAnimeByKitsuIds.mockResolvedValue([{ title: 'Cowboy Bebop' }]);

		await handler(req, res);

		const kitsuUrl = fetchMock.mock.calls[1][0] as string;
		expect(kitsuUrl).toContain('kitsu.io/api/edge/anime');
		expect(kitsuUrl).toContain('filter%5Btext%5D=bebop');
		expect(mockGetAnimeByKitsuIds).toHaveBeenCalledWith([1, 2]);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: [{ title: 'Cowboy Bebop' }] });
	});

	it('falls back when the addon answers with no matches', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { keyword: 'Obscure' } });
		const res = createMockResponse();
		const fetchMock = global.fetch as unknown as Mock;

		fetchMock
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ metas: [] }) })
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ data: [{ id: '42' }] }),
			});
		mockGetAnimeByKitsuIds.mockResolvedValue([{ title: 'Found' }]);

		await handler(req, res);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(mockGetAnimeByKitsuIds).toHaveBeenCalledWith([42]);
		expect(res.json).toHaveBeenCalledWith({ results: [{ title: 'Found' }] });
	});

	it('reports genuinely empty results rather than erroring', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { keyword: 'Nothing' } });
		const res = createMockResponse();
		const fetchMock = global.fetch as unknown as Mock;

		fetchMock
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ metas: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: [] }) });
		mockGetAnimeByKitsuIds.mockResolvedValue([]);

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: [] });
	});

	// What production received for this keyword on 2026-09-27: the addon's
	// Cloudflare block page and Kitsu's valid "no matches". It answered 500.
	it('answers a keyword nothing matches with an empty list', async () => {
		const handler = await loadHandler();
		const res = createMockResponse();
		const fetchMock = global.fetch as unknown as Mock;
		fetchMock.mockImplementation(async (url: string) =>
			url.startsWith('https://anime-kitsu.strem.fun/')
				? new Response(addonBlockPage, {
						status: 403,
						headers: { 'content-type': 'text/html; charset=UTF-8' },
					})
				: new Response(JSON.stringify(kitsuNoMatch), {
						status: 200,
						headers: { 'content-type': 'application/vnd.api+json' },
					})
		);
		mockGetAnimeByKitsuIds.mockResolvedValue([]);

		await handler(createMockRequest({ query: { keyword: 'zzqqxxnotananime' } }), res);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: [] });
	});

	it('still reports an error when the addon is blocked and Kitsu fails too', async () => {
		const handler = await loadHandler();
		const res = createMockResponse();
		const fetchMock = global.fetch as unknown as Mock;
		fetchMock
			.mockResolvedValueOnce(new Response(addonBlockPage, { status: 403 }))
			.mockResolvedValueOnce(new Response('upstream error', { status: 502 }));

		await handler(createMockRequest({ query: { keyword: 'frieren' } }), res);

		expect(res.status).toHaveBeenCalledWith(500);
	});

	// The addon answered these two URLs this way on 2026-09-27. A keyword with
	// a slash in it used to be pasted into the path raw, which is a 404.
	it('encodes the keyword into the addon path', async () => {
		const handler = await loadHandler();
		const res = createMockResponse();
		const fetchMock = global.fetch as unknown as Mock;
		fetchMock.mockImplementation(async (url: string) => {
			const recorded = addonFateZero.requests.find((r) => r.url === url);
			if (!recorded) return new Response('', { status: 503 }); // Kitsu: down
			const body =
				typeof recorded.body === 'string' ? recorded.body : JSON.stringify(recorded.body);
			return new Response(body, { status: recorded.status });
		});
		mockGetAnimeByKitsuIds.mockResolvedValue([{ title: 'Fate/Zero' }]);

		await handler(createMockRequest({ query: { keyword: 'Fate/Zero' } }), res);

		const encoded = addonFateZero.requests.find((r) => r.status === 200)!;
		expect(fetchMock).toHaveBeenCalledWith(encoded.url);
		expect(res.status).toHaveBeenCalledWith(200);
		const metas = (encoded.body as { metas: { id: string }[] }).metas;
		expect(mockGetAnimeByKitsuIds).toHaveBeenCalledWith(
			metas.map((m) => parseInt(m.id.replace('kitsu:', ''), 10))
		);
	});

	it('also encodes the characters that would end the path', async () => {
		const handler = await loadHandler();
		const fetchMock = global.fetch as unknown as Mock;
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ metas: [{ id: 'kitsu:1' }] }), { status: 200 })
		);
		mockGetAnimeByKitsuIds.mockResolvedValue([]);

		await handler(
			createMockRequest({ query: { keyword: 'Kaguya-sama wa Kokurasetai? #2' } }),
			createMockResponse()
		);

		expect(fetchMock).toHaveBeenCalledWith(
			'https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-list/search=kaguya-sama%20wa%20kokurasetai%3F%20%232.json'
		);
	});

	describe('keyword cache', () => {
		const answer = () =>
			new Response(JSON.stringify({ metas: [{ id: 'kitsu:7' }] }), { status: 200 });

		beforeEach(() => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-09-27T00:00:00Z'));
			(global.fetch as unknown as Mock).mockImplementation(async () => answer());
			mockGetAnimeByKitsuIds.mockResolvedValue([]);
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		const search = async (handler: Awaited<ReturnType<typeof loadHandler>>, keyword: string) =>
			handler(createMockRequest({ query: { keyword } }), createMockResponse());

		it('asks upstream again once an entry has aged out', async () => {
			const handler = await loadHandler();
			const fetchMock = global.fetch as unknown as Mock;

			await search(handler, 'Frieren');
			vi.setSystemTime(new Date('2026-09-27T05:59:00Z'));
			await search(handler, 'Frieren');
			expect(fetchMock).toHaveBeenCalledTimes(1);

			vi.setSystemTime(new Date('2026-09-27T06:00:01Z'));
			await search(handler, 'Frieren');
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('holds a bounded number of keywords, dropping the least recently used', async () => {
			const handler = await loadHandler();
			const fetchMock = global.fetch as unknown as Mock;

			for (let i = 0; i < 1000; i++) await search(handler, `keyword ${i}`);
			await search(handler, 'keyword 0'); // a hit: now the most recent
			await search(handler, 'one more'); // the cache is full: evicts keyword 1
			fetchMock.mockClear();

			await search(handler, 'keyword 0');
			expect(fetchMock).not.toHaveBeenCalled();
			await search(handler, 'keyword 1');
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});

	it('does not cache a failed lookup as an empty result', async () => {
		const handler = await loadHandler();
		const res1 = createMockResponse();
		const res2 = createMockResponse();
		const fetchMock = global.fetch as unknown as Mock;

		// First call: both upstreams report nothing.
		fetchMock
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ metas: [] }) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: [] }) });
		mockGetAnimeByKitsuIds.mockResolvedValue([]);
		await handler(createMockRequest({ query: { keyword: 'Later' } }), res1);

		// Second call must go back out rather than serve the empty list.
		fetchMock.mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ metas: [{ id: 'kitsu:9' }] }),
		});
		mockGetAnimeByKitsuIds.mockResolvedValue([{ title: 'Now indexed' }]);
		await handler(createMockRequest({ query: { keyword: 'Later' } }), res2);

		expect(mockGetAnimeByKitsuIds).toHaveBeenLastCalledWith([9]);
		expect(res2.json).toHaveBeenCalledWith({ results: [{ title: 'Now indexed' }] });
	});
});
