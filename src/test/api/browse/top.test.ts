import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/mdblistClient', () => ({
	getMdblistClient: vi.fn(),
}));

vi.mock('@/utils/seededShuffle', () => ({
	lcg: vi.fn(),
	shuffle: vi.fn(),
}));

import handler from '@/pages/api/browse/top';
import { getMdblistClient } from '@/services/mdblistClient';
import { lcg, shuffle } from '@/utils/seededShuffle';

const mockMdblistClient = vi.mocked(getMdblistClient);
const mockLcg = vi.mocked(lcg);
const mockShuffle = vi.mocked(shuffle);

describe('/api/browse/top', () => {
	let client: {
		getTopLists: ReturnType<typeof vi.fn>;
		getListItems: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		client = {
			getTopLists: vi.fn(),
			getListItems: vi.fn(),
		};
		mockMdblistClient.mockReturnValue(client as any);
		mockLcg.mockReturnValue(() => 0.42);
		mockShuffle.mockImplementation((lists) => lists);
	});

	it('responds with mapped mdblist catalog entries', async () => {
		client.getTopLists.mockResolvedValue([
			{ id: 1, name: 'Top Movies', mediatype: 'movie' },
			{ id: 2, name: 'Top Shows', mediatype: 'series' },
		]);
		client.getListItems.mockImplementation(async (id: number | string) => {
			if (Number(id) === 1) {
				return [{ imdb_id: 'tt0001' }, { imdb_id: 'tt0002' }, { imdb_id: null }];
			}
			return [{ imdb_id: 'tt1000' }];
		});

		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(client.getTopLists).toHaveBeenCalled();
		expect(client.getListItems).toHaveBeenCalledTimes(2);
		expect(client.getListItems).toHaveBeenCalledWith(expect.anything(), 50);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			'Top Movies': ['movie:tt0001', 'movie:tt0002'],
			'Top Shows': ['series:tt1000'],
		});
	});

	it('only processes up to four lists and trims entries to sixteen imdb ids', async () => {
		client.getTopLists.mockResolvedValue(
			Array.from({ length: 5 }).map((_, index) => ({
				id: index + 1,
				name: `List ${index + 1}`,
				mediatype: index % 2 === 0 ? 'movie' : 'series',
			}))
		);
		client.getListItems.mockImplementation(async (id: number | string) => {
			const numericId = Number(id);
			const items = Array.from({ length: 20 }).map((_, index) => ({
				imdb_id: `tt${numericId}${index.toString().padStart(2, '0')}`,
			}));
			delete (items[5] as any).imdb_id;
			return items;
		});

		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(client.getListItems).toHaveBeenCalledTimes(4);
		const payload = (res.json as Mock).mock.calls[0][0] as Record<string, string[]>;
		expect(Object.keys(payload)).toEqual(['List 1', 'List 2', 'List 3', 'List 4']);
		expect(payload['List 1']).toHaveLength(16);
		expect(payload['List 1']).toContain('movie:tt101');
		expect(payload).not.toHaveProperty('List 5');
	});
});
