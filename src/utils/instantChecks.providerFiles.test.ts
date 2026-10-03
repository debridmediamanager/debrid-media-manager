import { checkOffcloudCache } from '@/services/offcloud';
import { checkPremiumizeCache } from '@/services/premiumize';
import { checkCachedStatus } from '@/services/torbox';
import pmCacheCheck from '@/test/fixtures/instantChecks/spiderman3-uhd-premiumize-cache-check.json';
import rdCheck2 from '@/test/fixtures/instantChecks/spiderman3-uhd-rd-check2.json';
import tbCheckcached from '@/test/fixtures/instantChecks/spiderman3-uhd-torbox-checkcached.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAvailability } from './availability';
import {
	checkAvailabilityOc,
	checkAvailabilityPm,
	checkDatabaseAvailabilityRd,
	checkDatabaseAvailabilityTb,
} from './instantChecks';

// Real answers for one hash, captured 2026-10-03 (Fizzy card 169, reported by a
// user on Discord 2026-09-28). DMM's RD table lists the unpacked UHD disc, 115
// BDMV files; TorBox lists the same torrent as a single 80.7 GB .zip. The movie
// page runs both checks at once, so either can land second.
//
// A separate file for the same reason as instantChecks.fileSize.test.ts: the RD
// rate limiter keeps module-level timestamps.

vi.mock('./availability', () => ({
	checkAvailabilityByHashes: vi.fn(),
	checkAvailability: vi.fn(),
	checkAvailabilityAd: vi.fn(),
	checkAvailabilityAdByHashes: vi.fn(),
}));

vi.mock('@/services/torbox', () => ({
	checkCachedStatus: vi.fn(),
}));

vi.mock('@/services/premiumize', () => ({
	checkPremiumizeCache: vi.fn(),
}));

vi.mock('@/services/offcloud', () => ({
	checkOffcloudCache: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
	toast: { promise: vi.fn((p) => p), success: vi.fn(), error: vi.fn() },
}));

const HASH = '732d1e50abda37be16d3f7d520c1374f4424be5c';

const createStateHarness = <T extends { hash: string }>(initial: T[]) => {
	let state = [...initial];
	const setter = vi.fn((updater: ((prev: T[]) => T[]) | T[]) => {
		state = typeof updater === 'function' ? updater(state) : updater;
		return state;
	});
	return { getState: () => state, setter };
};

const freshRow = () =>
	({
		hash: HASH,
		title: 'Spider-Man 3',
		fileSize: 0,
		noVideos: false,
		rdAvailable: false,
		adAvailable: false,
		tbAvailable: false,
		pmAvailable: false,
		ocAvailable: false,
		dlAvailable: false,
		files: [],
		medianFileSize: 0,
		biggestFileSize: 0,
		videoCount: 0,
	}) as any;

const identity = (r: any[]) => r;

const runRd = (setter: any) =>
	checkDatabaseAvailabilityRd('key', 'solution', 'tt0413300', [HASH], setter, identity);
const runTb = (setter: any) => checkDatabaseAvailabilityTb('tb-key', [HASH], setter, identity);
const runPm = (setter: any) => checkAvailabilityPm('pm-key', [HASH], setter, identity);
const runOc = (setter: any) => checkAvailabilityOc('oc-key', [HASH], setter, identity);

const expectRdPlayableTbArchive = (row: any) => {
	expect(row.rdAvailable).toBe(true);
	expect(row.noVideos).toBe(false);
	// The folder chip renders on videoCount > 0; it must come from RD's listing.
	expect(row.videoCount).toBeGreaterThan(0);
	expect(row.files).toHaveLength(115);
	expect(row.rdFiles).toHaveLength(115);

	expect(row.tbAvailable).toBe(false);
	expect(row.tbFiles).toHaveLength(1);
	expect(row.tbFiles[0].filename).toMatch(/\.zip$/);
	expect(row.archiveOnly).toEqual({ tb: true });
};

describe('RD and TorBox file lists for the same hash', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(checkAvailability).mockResolvedValue(rdCheck2 as any);
		vi.mocked(checkCachedStatus).mockResolvedValue(tbCheckcached as any);
		// Premiumize's real cache/check answer for the hash, in the shape
		// checkPremiumizeCache turns it into.
		vi.mocked(checkPremiumizeCache).mockResolvedValue([
			{
				hash: HASH,
				cached: pmCacheCheck.response[0],
				filename: pmCacheCheck.filename[0],
				filesize: Number(pmCacheCheck.filesize[0]),
			},
		]);
		// No Offcloud key to capture with; its cache is measured to be
		// Premiumize's, so the hit mirrors the answer above.
		vi.mocked(checkOffcloudCache).mockResolvedValue([{ hash: HASH, cached: true }]);
	});

	it('keeps the RD listing when TorBox answers after RD with an archive', async () => {
		const { setter, getState } = createStateHarness([freshRow()]);

		await runRd(setter);
		await runTb(setter);

		expectRdPlayableTbArchive(getState()[0]);
	});

	it('still marks RD cached when TorBox answers first with an archive', async () => {
		const { setter, getState } = createStateHarness([freshRow()]);

		await runTb(setter);
		await runRd(setter);

		expectRdPlayableTbArchive(getState()[0]);
	});

	// TorBox packs disc torrents into one .zip: of 283 BDMV torrents TorBox held
	// on 2026-10-03, 122 came back as a single archive while RD listed every
	// one's m2ts files, and Premiumize had 79 of those 122 cached. An archive
	// listing says nothing about the torrent's contents.
	it('does not mark a row with no videos when the only listing is an archive', async () => {
		const { setter, getState } = createStateHarness([freshRow()]);

		await runTb(setter);

		const row = getState()[0];
		expect(row.noVideos).toBe(false);
		expect(row.videoCount).toBe(0);
		expect(row.archiveOnly).toEqual({ tb: true });
	});

	it('still checks Premiumize and Offcloud when TorBox only lists an archive', async () => {
		const { setter, getState } = createStateHarness([freshRow()]);

		await runTb(setter);
		await runPm(setter);
		await runOc(setter);

		const row = getState()[0];
		expect(row.tbAvailable).toBe(false);
		expect(row.pmAvailable).toBe(true);
		expect(row.ocAvailable).toBe(true);
	});

	it('keeps a listing without videos or archives authoritative over a later archive', async () => {
		vi.mocked(checkAvailability).mockResolvedValue({
			available: [
				{
					hash: HASH,
					files: [{ file_id: 1, path: '/Spider-Man 3/cover.jpg', bytes: 1024 }],
				},
			],
		} as any);
		const { setter, getState } = createStateHarness([freshRow()]);

		await runRd(setter);
		await runTb(setter);
		await runPm(setter);

		const row = getState()[0];
		expect(row.noVideos).toBe(true);
		expect(row.pmAvailable).toBe(false);
	});
});
