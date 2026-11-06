import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = {
	getTopLists: vi.fn(),
	searchLists: vi.fn(),
	getListItems: vi.fn(),
};

const mockGetMdblistClient = vi.fn(() => mockClient);
const mockLcg = vi.fn(() => () => 0.5);
const mockShuffle = vi.fn((items: any[]) => items);

vi.mock('@/services/mdblistClient', () => ({
	getMdblistClient: mockGetMdblistClient,
}));

vi.mock('@/utils/seededShuffle', () => ({
	lcg: mockLcg,
	shuffle: mockShuffle,
}));

describe('/api/info/browse', () => {
	const loadHandler = async () => {
		const mod = await import('@/pages/api/info/browse');
		return mod.default;
	};

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockClient.getTopLists.mockReset();
		mockClient.searchLists.mockReset();
		mockClient.getListItems.mockReset();
	});

	it('fetches top lists when no search query is provided', async () => {
		const handler = await loadHandler();
		const req = createMockRequest();
		const res = createMockResponse();
		mockClient.getTopLists.mockResolvedValue([
			{ id: 1, name: 'Movie Picks', mediatype: 'movie' },
			{ id: 2, name: 'Show Picks', mediatype: 'series' },
		]);
		mockClient.getListItems.mockImplementation(async (listId: string) => {
			if (listId === '1') {
				return [
					{ imdb_id: 'tt001', title: 'First', mediatype: 'movie' },
					{ imdb_id: 'tt002', title: 'Second', mediatype: null },
					{ imdb_id: null, title: 'Invalid' },
				];
			}
			return [
				{ imdb_id: 'tt001', title: 'First', mediatype: null },
				{ imdb_id: 'tt002', title: 'Second', mediatype: null },
			];
		});

		await handler(req, res);

		expect(mockGetMdblistClient).toHaveBeenCalled();
		expect(mockClient.getTopLists).toHaveBeenCalled();
		expect(mockClient.searchLists).not.toHaveBeenCalled();
		expect(mockClient.getListItems).toHaveBeenCalledTimes(2);
		expect(mockClient.getListItems).toHaveBeenCalledWith('1', 50);
		expect(mockShuffle).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		const payload = (res.json as Mock).mock.calls[0][0] as Record<string, string[]>;
		expect(payload['Movie Picks']).toEqual(['movie:tt001:First', 'movie:tt002:Second']);
		expect(payload['Show Picks']).toEqual(['series:tt001:First', 'series:tt002:Second']);
	});

	it('uses searchLists when a search query is provided and caches responses', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { search: 'My%20List!@#' } });
		const res = createMockResponse();
		const res2 = createMockResponse();

		mockClient.searchLists.mockResolvedValue([{ id: 5, name: 'Custom', mediatype: null }]);
		mockClient.getListItems.mockResolvedValue([
			{ imdb_id: 'tt100', title: 'X', mediatype: null },
		]);

		await handler(req, res);

		expect(mockClient.searchLists).toHaveBeenCalledWith('my list   ');
		expect(res.status).toHaveBeenCalledWith(200);
		expect((res.json as Mock).mock.calls[0][0]).toEqual({
			Custom: ['show:tt100:X'],
		});

		mockGetMdblistClient.mockClear();
		mockClient.searchLists.mockClear();
		mockClient.getListItems.mockClear();

		await handler(req, res2);

		expect(mockGetMdblistClient).not.toHaveBeenCalled();
		expect(mockClient.searchLists).not.toHaveBeenCalled();
		expect(res2.status).toHaveBeenCalledWith(200);
		expect(res2.json).toHaveBeenCalledWith({
			Custom: ['show:tt100:X'],
		});
	});

	it('returns 500 when mdblist calls fail', async () => {
		const handler = await loadHandler();
		const req = createMockRequest();
		const res = createMockResponse();
		mockClient.getTopLists.mockRejectedValue(new Error('mdblist down'));

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch browse information' });
	});
});
