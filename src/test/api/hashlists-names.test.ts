import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tree from '../fixtures/hashlist/hashlists-tree-2026-11-14.json';

// The real git tree of the hashlists repo, cut to 1,100 of its 15,274 pages
// (fixtures/hashlist/README.md). The contents API stops at 1,000 entries.
const pages = tree.tree.filter((e) => e.type === 'blob' && e.path.endsWith('.html'));
const listPages = pages.filter((e) => e.path !== 'index.html').map((e) => e.path);

async function call() {
	// a fresh module each time: the route keeps its list between requests
	const { default: handler } = await import('@/pages/api/hashlists/names');
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'GET' }), res);
	return res;
}

describe('GET /api/hashlists/names', () => {
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.resetModules();
		fetchSpy = vi.fn(async () => ({ ok: true, json: async () => tree }));
		vi.stubGlobal('fetch', fetchSpy);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('lists every hash list page in the tree, past the contents API cap', async () => {
		const res = await call();

		expect(fetchSpy).toHaveBeenCalledWith(
			'https://api.github.com/repos/debridmediamanager/hashlists/git/trees/main',
			expect.anything()
		);
		const { names } = res._getData() as { names: string[] };
		expect(listPages.length).toBeGreaterThan(1000);
		expect(names).toEqual(listPages);
		expect(names).not.toContain('index.html');
		expect(names).not.toContain('CNAME');
		expect(names).not.toContain('lists');
	});

	it('asks GitHub once per ten minutes', async () => {
		const { default: handler } = await import('@/pages/api/hashlists/names');
		for (let i = 0; i < 3; i++) {
			await handler(createMockRequest({ method: 'GET' }), createMockResponse());
		}
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('answers 502 when GitHub fails and nothing is cached', async () => {
		fetchSpy.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const res = await call();

		expect(res._getStatusCode()).toBe(502);
	});
});
