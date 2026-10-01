import { TakedownService } from '@/services/database/takedown';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
	getBlocklist,
	hasLoadedBlocklist,
	invalidateBlocklist,
	isNzbBlocked,
	resetBlocklistForTests,
	setBlocklistForTests,
	withoutBlockedHashes,
	withoutBlockedReleases,
} from './blocklist';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('getBlocklist', () => {
	let getBlocked: MockInstance<TakedownService['getBlocked']>;

	beforeEach(() => {
		resetBlocklistForTests();
		vi.useFakeTimers();
		getBlocked = vi.spyOn(TakedownService.prototype, 'getBlocked');
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('reads the tables once per minute', async () => {
		getBlocked.mockResolvedValue({ hashes: [A], releases: [] });
		expect((await getBlocklist()).hashes.has(A)).toBe(true);
		await getBlocklist();
		expect(getBlocked).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(61_000);
		getBlocked.mockResolvedValue({ hashes: [A, B], releases: [] });
		expect((await getBlocklist()).hashes.has(B)).toBe(true);
		expect(getBlocked).toHaveBeenCalledTimes(2);
	});

	it('rereads at once after an approval on this replica', async () => {
		getBlocked.mockResolvedValue({ hashes: [], releases: [] });
		await getBlocklist();
		getBlocked.mockResolvedValue({ hashes: [A], releases: [] });
		invalidateBlocklist();
		expect((await getBlocklist()).hashes.has(A)).toBe(true);
	});

	it('keeps the last good list through a database error', async () => {
		getBlocked.mockResolvedValue({ hashes: [A], releases: [] });
		const first = await getBlocklist();
		vi.advanceTimersByTime(61_000);
		getBlocked.mockRejectedValue(new Error('db down'));
		expect(await getBlocklist()).toBe(first);
		expect(hasLoadedBlocklist()).toBe(true);
	});

	it('reports a cold replica that never loaded as not loaded', async () => {
		getBlocked.mockRejectedValue(new Error('db down'));
		expect((await getBlocklist()).hashes.size).toBe(0);
		expect(hasLoadedBlocklist()).toBe(false);
	});

	it('changes the version when the contents change, not otherwise', async () => {
		getBlocked.mockResolvedValue({ hashes: [A, B], releases: [] });
		const one = (await getBlocklist()).version;
		invalidateBlocklist();
		getBlocked.mockResolvedValue({ hashes: [B, A], releases: [] });
		expect((await getBlocklist()).version).toBe(one);
		invalidateBlocklist();
		getBlocked.mockResolvedValue({ hashes: [A], releases: [] });
		expect((await getBlocklist()).version).not.toBe(one);
	});
});

describe('filters', () => {
	beforeEach(() => setBlocklistForTests([A], ['big.buck.bunny.2008.1080p']));

	it('drops blocked rows whatever the hash case', async () => {
		const rows = [{ hash: A.toUpperCase() }, { hash: B }];
		expect(await withoutBlockedHashes(rows)).toEqual([{ hash: B }]);
	});

	it('passes non-arrays through', async () => {
		expect(await withoutBlockedHashes(undefined)).toBeUndefined();
		expect(await withoutBlockedHashes(null)).toBeNull();
	});

	it('drops Usenet results by normalized title', async () => {
		const results = [{ title: 'Big Buck Bunny 2008 1080p' }, { title: 'Tears.of.Steel.2012' }];
		expect(await withoutBlockedReleases(results)).toEqual([{ title: 'Tears.of.Steel.2012' }]);
	});

	it('judges an NZB by its declared name', async () => {
		const nzb = `<?xml version="1.0"?><nzb><head><meta type="name">Big.Buck.Bunny.2008.1080p</meta></head></nzb>`;
		expect(await isNzbBlocked(nzb)).toBe(true);
		expect(await isNzbBlocked('<nzb></nzb>')).toBe(false);
		expect(await isNzbBlocked('<nzb></nzb>', 'Big Buck Bunny 2008 1080p.nzb')).toBe(true);
	});
});
