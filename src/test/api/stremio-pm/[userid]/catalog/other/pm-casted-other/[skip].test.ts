import handler from '@/pages/api/stremio-pm/[userid]/catalog/other/pm-casted-other/[skip]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getPremiumizeDMMLibrary } from '@/utils/premiumizeCastCatalogHelper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/premiumizeCastCatalogHelper', async () => {
	const actual = await vi.importActual<typeof import('@/utils/premiumizeCastCatalogHelper')>(
		'@/utils/premiumizeCastCatalogHelper'
	);
	return { ...actual, getPremiumizeDMMLibrary: vi.fn() };
});

const mockLibrary = vi.mocked(getPremiumizeDMMLibrary);

describe('/api/stremio-pm/[userid]/catalog/other/pm-casted-other/[skip]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockLibrary.mockResolvedValue({
			data: { metas: [], hasMore: false, cacheMaxAge: 0 },
			status: 200,
		} as any);
	});

	// Stremio packs the extra into the path segment, so the handler never sees a
	// bare integer. Reading it as a page number is what broke AllDebrid's library.
	it.each([
		['skip=12.json', 2],
		['skip=24.json', 3],
		['skip=0.json', 1],
		['24', 3],
		['not-a-number', 1],
	])('resolves the %s extra to page %i', async (skip, page) => {
		await handler(createMockRequest({ query: { userid: 'user1', skip } }), res);
		expect(mockLibrary).toHaveBeenCalledWith('user1', page);
	});

	it('returns 400 when skip is missing', async () => {
		await handler(createMockRequest({ query: { userid: 'user1' } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('passes the helper error status through', async () => {
		mockLibrary.mockResolvedValue({ error: 'no profile', status: 401 } as any);
		await handler(createMockRequest({ query: { userid: 'user1', skip: 'skip=12.json' } }), res);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('returns 500 when the helper throws', async () => {
		mockLibrary.mockRejectedValue(new Error('boom'));
		await handler(createMockRequest({ query: { userid: 'user1', skip: 'skip=12.json' } }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
