import handler from '@/pages/api/stremio-pm/[userid]/meta/other/[id]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getPremiumizeDMMItem } from '@/utils/premiumizeCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/premiumizeCastCatalogHelper', async () => {
	const actual = await vi.importActual<typeof import('@/utils/premiumizeCastCatalogHelper')>(
		'@/utils/premiumizeCastCatalogHelper'
	);
	return { ...actual, getPremiumizeDMMItem: vi.fn() };
});

const mockItem = vi.mocked(getPremiumizeDMMItem);

describe('/api/stremio-pm/[userid]/meta/other/[id]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockItem.mockResolvedValue({
			data: { meta: { id: 'x' }, cacheMaxAge: 0 },
			status: 200,
		} as any);
	});

	it('resolves a folder id, trailing .json included', async () => {
		await handler(
			createMockRequest({ query: { userid: 'user1', id: 'dmm-pm:folder:f1.json' } }),
			res
		);
		expect(mockItem).toHaveBeenCalledWith('user1', 'folder', 'f1');
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('resolves a file id', async () => {
		await handler(createMockRequest({ query: { userid: 'user1', id: 'dmm-pm:file:v1' } }), res);
		expect(mockItem).toHaveBeenCalledWith('user1', 'file', 'v1');
	});

	// Every DMM Cast addon declares the `dmm` meta prefix, so Stremio fans a
	// library id out to all of them. A sibling's id must come back null, not 500.
	it.each(['dmm:RDTORRENT', 'dmm-tb:123', 'dmm-ad:456', 'dmm-oc:req1', 'dmm-dl:seed1'])(
		'returns a null meta for %s',
		async (id) => {
			await handler(createMockRequest({ query: { userid: 'user1', id } }), res);
			expect(res.status).toHaveBeenCalledWith(200);
			expect(res._getData()).toEqual({ meta: null });
			expect(mockItem).not.toHaveBeenCalled();
		}
	);

	it('returns 400 when userid or id is missing', async () => {
		await handler(createMockRequest({ query: { userid: 'user1' } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('passes the helper error status through', async () => {
		mockItem.mockResolvedValue({ error: 'nope', status: 404 } as any);
		await handler(
			createMockRequest({ query: { userid: 'user1', id: 'dmm-pm:folder:f1' } }),
			res
		);
		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('returns 500 when the helper throws', async () => {
		mockItem.mockRejectedValue(new Error('boom'));
		await handler(
			createMockRequest({ query: { userid: 'user1', id: 'dmm-pm:folder:f1' } }),
			res
		);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
