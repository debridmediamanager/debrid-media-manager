import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from './repository';
import { setBlocklistForTests } from './takedown/blocklist';

// Every surface reads and writes hashes through this facade, so a takedown is
// enforced here once instead of in each route.

const BLOCKED = 'a'.repeat(40);
const KEPT = 'b'.repeat(40);
const row = (hash: string) => ({ hash, title: 'Big.Buck.Bunny.2008', fileSize: 1 });

const build = () => {
	const scraped = {
		getScrapedTrueResults: vi.fn(async () => [row(BLOCKED), row(KEPT)]),
		getScrapedResults: vi.fn(async () => [row(BLOCKED.toUpperCase()), row(KEPT)]),
		getAllScrapedTrueResults: vi.fn(async () => [row(BLOCKED), row(KEPT)]),
		getScrapedTrueRow: vi.fn(async () => ({
			results: [row(BLOCKED), row(KEPT)],
			updatedAt: new Date(0),
		})),
		saveScrapedResults: vi.fn(),
		saveScrapedTrueResults: vi.fn(),
	};
	const availability = {
		checkAvailabilityByHashes: vi.fn(async (hashes: string[]) => hashes),
		getCachedRdNames: vi.fn(
			async (hashes: string[]) =>
				new Map(hashes.map((hash) => [hash, { filename: hash, originalFilename: hash }]))
		),
		filterPlayableCachedHashes: vi.fn(async (hashes: string[]) => new Set(hashes)),
		filterPlayableCachedHashesAd: vi.fn(async (hashes: string[]) => new Set(hashes)),
		upsertAvailability: vi.fn(),
		saveInstantAvailability: vi.fn(),
	};
	const cast = { getOtherStreams: vi.fn(async () => [row(BLOCKED), row(KEPT)]) };
	const hashSearch = { getHashesByImdbId: vi.fn(async () => [row(BLOCKED), row(KEPT)]) };
	const snapshots = { getLatestSnapshot: vi.fn(async () => ({ id: 's' })) };
	const repo = new Repository({
		scrapedService: scraped as any,
		availabilityService: availability as any,
		castService: cast as any,
		hashSearchService: hashSearch as any,
		torrentSnapshotService: snapshots as any,
	});
	return { repo, scraped, availability, snapshots };
};

describe('Repository takedown enforcement', () => {
	beforeEach(() => setBlocklistForTests([BLOCKED]));

	it('drops blocked hashes from every scraped read', async () => {
		const { repo } = build();
		expect(await repo.getScrapedTrueResults<any[]>('movie:tt1')).toEqual([row(KEPT)]);
		expect(await repo.getScrapedResults<any[]>('movie:tt1')).toEqual([row(KEPT)]);
		expect(await repo.getAllScrapedTrueResults('movie:tt1')).toEqual([row(KEPT)]);
		expect((await repo.getScrapedTrueRow('movie:tt1'))?.results).toEqual([row(KEPT)]);
	});

	it('refuses blocked hashes on every scraped save, so a crawl cannot restore them', async () => {
		const { repo, scraped } = build();
		await repo.saveScrapedResults('movie:tt1', [row(BLOCKED), row(KEPT)]);
		await repo.saveScrapedTrueResults('movie:tt1', [row(BLOCKED), row(KEPT)]);
		expect(scraped.saveScrapedResults.mock.calls[0][1]).toEqual([row(KEPT)]);
		expect(scraped.saveScrapedTrueResults.mock.calls[0][1]).toEqual([row(KEPT)]);
	});

	it('never reports a blocked hash as cached', async () => {
		const { repo } = build();
		expect(await repo.checkAvailabilityByHashes([BLOCKED, KEPT])).toEqual([KEPT]);
		expect([...(await repo.getCachedRdNames([BLOCKED, KEPT])).keys()]).toEqual([KEPT]);
		expect(await repo.filterPlayableCachedHashes([BLOCKED, KEPT])).toEqual(new Set([KEPT]));
		expect(await repo.filterPlayableCachedHashesAd([BLOCKED, KEPT])).toEqual(new Set([KEPT]));
	});

	it('keeps blocked hashes out of the shared availability tables', async () => {
		const { repo, availability } = build();
		await repo.upsertAvailability({ hash: BLOCKED } as any);
		await repo.saveInstantAvailability('tt1', [{ hash: BLOCKED, filename: 'x', bytes: 1 }]);
		expect(availability.upsertAvailability).not.toHaveBeenCalled();
		expect(availability.saveInstantAvailability).toHaveBeenCalledWith('tt1', []);
	});

	it("drops blocked hashes from other users' streams and zurg's hash search", async () => {
		const { repo } = build();
		expect(await repo.getOtherStreams('tt1', 'u')).toEqual([row(KEPT)]);
		expect(await repo.getHashesByImdbId({ imdbId: 'tt1' } as any)).toEqual([row(KEPT)]);
	});

	it('serves no snapshot for a blocked hash', async () => {
		const { repo, snapshots } = build();
		expect(await repo.getLatestTorrentSnapshot(BLOCKED)).toBeNull();
		expect(snapshots.getLatestSnapshot).not.toHaveBeenCalled();
		expect(await repo.getLatestTorrentSnapshot(KEPT)).toEqual({ id: 's' });
	});

	it('changes nothing while no notice is approved', async () => {
		setBlocklistForTests([]);
		const { repo } = build();
		expect(await repo.getScrapedTrueResults<any[]>('movie:tt1')).toHaveLength(2);
	});
});
