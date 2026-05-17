import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getCachedTrackerStats,
	getMultipleTrackerStats,
	shouldIncludeTrackerStats,
} from './trackerStats';

const fetchMock = vi.fn();

describe('trackerStats utils', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		(globalThis as any).fetch = fetchMock;
		window.localStorage.clear();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('batches tracker stat requests and merges the responses', async () => {
		const firstResponse = { ok: true, json: vi.fn().mockResolvedValue([{ hash: 'hash-0' }]) };
		const secondResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue([{ hash: 'hash-1' }]),
		};

		fetchMock.mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(secondResponse);

		const hashes = Array.from({ length: 120 }, (_, index) => `hash-${index}`);
		const results = await getMultipleTrackerStats(hashes, 'tt1234567');

		expect(results).toEqual([{ hash: 'hash-0' }, { hash: 'hash-1' }]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const firstPayload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
		expect(firstPayload.hashes).toHaveLength(100);
	});

	it('throws when the bulk tracker endpoint responds with an error', async () => {
		const errorResponse = {
			ok: false,
			json: vi.fn().mockResolvedValue({ error: 'boom' }),
		};
		fetchMock.mockResolvedValue(errorResponse);

		await expect(getMultipleTrackerStats(['hash-1'], 'tt1234567')).rejects.toThrow('boom');
		expect(errorResponse.json).toHaveBeenCalled();
	});

	it('reads the tracker stats flag from localStorage', () => {
		window.localStorage.setItem('settings:includeTrackerStats', 'true');
		expect(shouldIncludeTrackerStats()).toBe(true);
		window.localStorage.setItem('settings:includeTrackerStats', 'false');
		expect(shouldIncludeTrackerStats()).toBe(false);

		const originalWindow = global.window;
		// @ts-expect-error overriding window for this assertion
		global.window = undefined;
		expect(shouldIncludeTrackerStats()).toBe(false);
		global.window = originalWindow;
	});

	it('returns cached stats when they are fresh and force refresh is off', async () => {
		const storedStats = {
			hash: 'abc',
			seeders: 10,
			leechers: 5,
			downloads: 1,
			successfulTrackers: 2,
			totalTrackers: 4,
			lastChecked: new Date().toISOString(),
		};

		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: vi.fn().mockResolvedValue(storedStats),
		});

		const result = await getCachedTrackerStats('abc');
		expect(result).toEqual(storedStats);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('fetches fresh stats when cached ones are stale', async () => {
		const storedStats = {
			hash: 'abc',
			seeders: 0,
			leechers: 0,
			downloads: 0,
			successfulTrackers: 0,
			totalTrackers: 0,
			lastChecked: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
		};
		const freshStats = {
			hash: 'abc',
			seeders: 4,
			leechers: 2,
			downloads: 10,
			trackers: { successful: 3, total: 5 },
		};

		fetchMock
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(storedStats) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(freshStats) });

		const result = await getCachedTrackerStats('abc');
		expect(result).toMatchObject({
			hash: 'abc',
			seeders: 4,
			leechers: 2,
			downloads: 10,
			successfulTrackers: 3,
			totalTrackers: 5,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('respects the forceRefresh flag', async () => {
		const storedStats = {
			hash: 'abc',
			seeders: 1,
			leechers: 1,
			downloads: 1,
			successfulTrackers: 1,
			totalTrackers: 1,
			lastChecked: new Date().toISOString(),
		};
		const freshStats = {
			hash: 'abc',
			seeders: 2,
			leechers: 2,
			downloads: 2,
			trackers: { successful: 2, total: 2 },
		};

		fetchMock
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(storedStats) })
			.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(freshStats) });

		const result = await getCachedTrackerStats('abc', 24, true);
		expect(result).toMatchObject({
			seeders: 2,
			leechers: 2,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('returns null when the fresh stats endpoint fails', async () => {
		fetchMock.mockResolvedValueOnce({ ok: false, json: vi.fn() }).mockResolvedValueOnce({
			ok: false,
			json: vi.fn().mockResolvedValue({ error: 'tracker offline' }),
		});

		const result = await getCachedTrackerStats('hash-err');
		expect(result).toBeNull();
	});
});
