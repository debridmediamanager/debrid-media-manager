import handler from '@/pages/api/calendar';
import { getMdblistCacheService } from '@/services/database/mdblistCache';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getTmdbKey } from '@/utils/freekeys';
import axios from 'axios';
import getConfig from 'next/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('next/config');
vi.mock('@/services/database/mdblistCache');
vi.mock('@/utils/freekeys');

const mockAxios = vi.mocked(axios);
const mockGetConfig = vi.mocked(getConfig);
const mockGetMdblistCacheService = vi.mocked(getMdblistCacheService);
const mockGetTmdbKey = vi.mocked(getTmdbKey);

const mockCache = {
	getWithMetadata: vi.fn(),
	set: vi.fn(),
};

const makeTraktItem = (overrides: Record<string, unknown> = {}) => ({
	first_aired: '2024-06-01T20:00:00.000Z',
	episode: { season: 1, number: 1, title: 'Pilot' },
	show: {
		title: 'Test Show',
		ids: { trakt: '123', imdb: 'tt1234567' },
		network: 'HBO',
		country: 'us',
	},
	...overrides,
});

const makeTmdbResponse = (results: unknown[] = []) => ({
	data: { results },
});

const makeAxiosResponses = (
	allItems: unknown[] = [makeTraktItem()],
	premiereItems: unknown[] = []
) => {
	(mockAxios.get as ReturnType<typeof vi.fn>)
		.mockResolvedValueOnce({ data: allItems })
		.mockResolvedValueOnce({ data: premiereItems })
		.mockResolvedValueOnce(makeTmdbResponse())
		.mockResolvedValueOnce(makeTmdbResponse());
};

describe('/api/calendar', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetConfig.mockReturnValue({
			publicRuntimeConfig: { traktClientId: 'test-trakt-id' },
			serverRuntimeConfig: {},
		});
		mockGetMdblistCacheService.mockReturnValue(mockCache as any);
		mockGetTmdbKey.mockReturnValue('test-tmdb-key');
		mockCache.getWithMetadata.mockResolvedValue(null);
		mockCache.set.mockResolvedValue(undefined);
		process.env.TRAKT_CLIENT_ID = '';
		process.env.TMDB_KEY = '';
	});

	it('returns cached response when cache is fresh', async () => {
		const cachedData = {
			range: { start: '2024-06-01', days: 7 },
			days: [],
			tmdb: { airingToday: [], onTheAir: [] },
		};
		mockCache.getWithMetadata.mockResolvedValue({
			data: cachedData,
			updatedAt: new Date(),
		});

		const req = createMockRequest({ query: { start: '2024-06-01', days: '7' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(cachedData);
		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
		expect(mockAxios.get).not.toHaveBeenCalled();
	});

	it('makes API calls when cache is stale', async () => {
		mockCache.getWithMetadata.mockResolvedValue({
			data: {},
			updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
		});
		makeAxiosResponses();

		const req = createMockRequest({ query: { start: '2024-06-01', days: '7' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockAxios.get).toHaveBeenCalledTimes(4);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('makes API calls when cache is missing', async () => {
		mockCache.getWithMetadata.mockResolvedValue(null);
		makeAxiosResponses();

		const req = createMockRequest({ query: { start: '2024-06-01', days: '7' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockAxios.get).toHaveBeenCalledTimes(4);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('uses default start date and days when not specified', async () => {
		makeAxiosResponses();

		const req = createMockRequest({ query: {} });
		const res = createMockResponse();

		await handler(req, res);

		const firstCall = (mockAxios.get as ReturnType<typeof vi.fn>).mock.calls[0];
		const today = new Date().toISOString().slice(0, 10);
		expect(firstCall[0]).toContain(`/${today}/7`);
	});

	it('clamps days to minimum 1', async () => {
		makeAxiosResponses();

		const req = createMockRequest({ query: { start: '2024-06-01', days: '-5' } });
		const res = createMockResponse();

		await handler(req, res);

		const firstCall = (mockAxios.get as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(firstCall[0]).toContain('/2024-06-01/1');
	});

	it('clamps days to maximum 31', async () => {
		makeAxiosResponses();

		const req = createMockRequest({ query: { start: '2024-06-01', days: '100' } });
		const res = createMockResponse();

		await handler(req, res);

		const firstCall = (mockAxios.get as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(firstCall[0]).toContain('/2024-06-01/31');
	});

	it('returns 400 when TRAKT_CLIENT_ID not configured', async () => {
		mockGetConfig.mockReturnValue({
			publicRuntimeConfig: {},
			serverRuntimeConfig: {},
		});

		const req = createMockRequest({ query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'TRAKT_CLIENT_ID not configured' });
	});

	it('returns 500 on API failure', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		(mockAxios.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

		const req = createMockRequest({ query: { start: '2024-06-01', days: '7' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to load calendar data' });
	});

	it('merges premiere and regular events correctly', async () => {
		const regularItem = makeTraktItem();
		const premiereItem = makeTraktItem({
			show: {
				title: 'Premiere Show',
				ids: { trakt: '456', imdb: 'tt9999999' },
				network: 'Netflix',
				country: 'us',
			},
		});

		(mockAxios.get as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ data: [regularItem] })
			.mockResolvedValueOnce({ data: [premiereItem] })
			.mockResolvedValueOnce(makeTmdbResponse())
			.mockResolvedValueOnce(makeTmdbResponse());

		const req = createMockRequest({ query: { start: '2024-06-01', days: '7' } });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as any;
		const dayItems = data.days[0].items;
		expect(dayItems).toHaveLength(2);
		const titles = dayItems.map((i: any) => i.title);
		expect(titles).toContain('Test Show');
		expect(titles).toContain('Premiere Show');
		const premiere = dayItems.find((i: any) => i.title === 'Premiere Show');
		expect(premiere.isPremiere).toBe(true);
	});

	it('sets Cache-Control header on success', async () => {
		makeAxiosResponses();

		const req = createMockRequest({ query: { start: '2024-06-01', days: '7' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
	});

	it('marks duplicate events as premiere when premiere data overlaps', async () => {
		const item = makeTraktItem();

		(mockAxios.get as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ data: [item] })
			.mockResolvedValueOnce({ data: [item] })
			.mockResolvedValueOnce(makeTmdbResponse())
			.mockResolvedValueOnce(makeTmdbResponse());

		const req = createMockRequest({ query: { start: '2024-06-01', days: '7' } });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as any;
		expect(data.days[0].items).toHaveLength(1);
		expect(data.days[0].items[0].isPremiere).toBe(true);
	});
});
