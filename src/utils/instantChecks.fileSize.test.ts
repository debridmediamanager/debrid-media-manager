import type { SearchResult } from '@/services/mediasearch';
import { checkCachedStatus } from '@/services/torbox';
import gameOfThrones from '@/test/fixtures/sortByMedian/game-of-thrones-s01-2026-10-31.json';
import gameOfThronesUhd from '@/test/fixtures/sortByMedian/game-of-thrones-s01-s08-2160p-2026-10-31.json';
import seinfeld from '@/test/fixtures/sortByMedian/seinfeld-s01-2026-10-31.json';
import tatami from '@/test/fixtures/sortByMedian/tatami-galaxy-s01-2026-10-31.json';
import lastOfUs from '@/test/fixtures/sortByMedian/the-last-of-us-s02-2026-10-31.json';
import officeUs from '@/test/fixtures/sortByMedian/the-office-us-s01-2026-10-31.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkAvailability,
	checkAvailabilityAd,
	checkAvailabilityAdByHashes,
} from './availability';
import {
	checkDatabaseAvailabilityAd,
	checkDatabaseAvailabilityRd,
	checkDatabaseAvailabilityTb,
} from './instantChecks';
import { episodeSize, packEpisodes, sortByMedian } from './results';

// Kept out of instantChecks.test.ts on purpose: the RD rate limiter keeps
// module-level timestamps, and that file already runs at its 10-requests-per-10s
// budget. A separate file gets a fresh module registry.

vi.mock('./availability', () => ({
	checkAvailabilityByHashes: vi.fn(),
	checkAvailability: vi.fn(),
	checkAvailabilityAd: vi.fn(),
	checkAvailabilityAdByHashes: vi.fn(),
}));

vi.mock('@/services/torbox', () => ({
	checkCachedStatus: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
	toast: {
		promise: vi.fn((p) => p),
		success: vi.fn(),
		loading: vi.fn(() => 'toast-id'),
		error: vi.fn(),
	},
}));

vi.mock('@/utils/selectable', () => ({
	isVideo: ({ path }: { path: string }) => path.endsWith('.mkv'),
}));

const mockCheckAvailability = vi.mocked(checkAvailability);
const mockCheckAvailabilityAd = vi.mocked(checkAvailabilityAd);
const mockCheckAvailabilityAdByHashes = vi.mocked(checkAvailabilityAdByHashes);
const mockCheckCachedStatus = vi.mocked(checkCachedStatus);

const createStateHarness = <T extends { hash: string }>(initial: T[]) => {
	let state = [...initial];
	const setter = vi.fn((updater: ((prev: T[]) => T[]) | T[]) => {
		state = typeof updater === 'function' ? updater(state) : updater;
		return state;
	});
	return { getState: () => state, setter };
};

const identity = (r: any[]) => r;
const MB = 1024 * 1024;

describe('missing fileSize backfill', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('fills in fileSize from RD file bytes when the reported size is 0', async () => {
		mockCheckAvailability.mockResolvedValue({
			available: [
				{
					hash: 'hash-zero-rd',
					files: [
						{ file_id: 1, path: 'Movie.mkv', bytes: 8 * MB },
						{ file_id: 2, path: 'Movie.srt', bytes: 2 * MB },
					],
				},
			],
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'hash-zero-rd',
				noVideos: false,
				rdAvailable: false,
				files: [],
				fileSize: 0,
				medianFileSize: 0,
				biggestFileSize: 0,
			},
		] as any[]);

		await checkDatabaseAvailabilityRd(
			'problem',
			'solution',
			'tt1234567',
			['hash-zero-rd'],
			setter,
			identity
		);

		// every file counts toward the total, not just the video ones
		expect(getState()[0].fileSize).toBe(10);
	});

	it('leaves a known fileSize untouched', async () => {
		mockCheckAvailability.mockResolvedValue({
			available: [
				{
					hash: 'hash-known',
					files: [{ file_id: 1, path: 'Movie.mkv', bytes: 8 * MB }],
				},
			],
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'hash-known',
				noVideos: false,
				rdAvailable: false,
				files: [],
				fileSize: 1234,
				medianFileSize: 0,
				biggestFileSize: 0,
			},
		] as any[]);

		await checkDatabaseAvailabilityRd(
			'problem',
			'solution',
			'tt1234567',
			['hash-known'],
			setter,
			identity
		);

		expect(getState()[0].fileSize).toBe(1234);
	});

	it('fills in fileSize from AD file bytes when the reported size is 0', async () => {
		mockCheckAvailabilityAd.mockResolvedValue({
			available: [
				{
					hash: 'hash-zero-ad',
					files: [{ file_id: 1, path: 'Movie.mkv', bytes: 5 * MB }],
				},
			],
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'hash-zero-ad',
				noVideos: false,
				adAvailable: false,
				files: [],
				fileSize: 0,
				medianFileSize: 0,
				biggestFileSize: 0,
			},
		] as any[]);

		await checkDatabaseAvailabilityAd(
			'problem',
			'solution',
			'tt1234567',
			['hash-zero-ad'],
			setter,
			identity
		);

		expect(getState()[0].fileSize).toBe(5);
	});

	it('fills in fileSize from TB file bytes when the reported size is 0', async () => {
		mockCheckCachedStatus.mockResolvedValue({
			success: true,
			data: {
				'hash-zero-tb': {
					files: [{ name: 'Show.mkv', size: 3 * MB }],
				},
			},
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'hash-zero-tb',
				noVideos: false,
				tbAvailable: false,
				files: [],
				fileSize: 0,
				medianFileSize: 0,
				biggestFileSize: 0,
			},
		] as any[]);

		await checkDatabaseAvailabilityTb('tb-key', ['hash-zero-tb'], setter, identity);

		expect(getState()[0].fileSize).toBe(3);
	});

	// The TTGA remux carries a 45 MB opening and a 675 MB ending beside its 5.1 GB
	// episodes, which pulled its mean under the S0L0PURE remux's 4.6 GB episodes.
	it('ranks a cached season on its median video, so short extras do not sink it', async () => {
		mockCheckAvailability.mockResolvedValue({ available: tatami.available } as any);
		const { setter, getState } = createStateHarness(
			tatami.available.map((t) => ({
				hash: t.hash,
				title: t.title,
				noVideos: false,
				rdAvailable: false,
				files: [],
				fileSize: t.bytes / MB,
				medianFileSize: 0,
				biggestFileSize: 0,
				videoCount: 0,
			})) as any[]
		);

		await checkDatabaseAvailabilityRd(
			'problem',
			'solution',
			'tt1847445',
			tatami.available.map((t) => t.hash),
			setter,
			identity
		);

		expect(sortByMedian([...getState()]).map((r) => r.title)).toEqual([
			'The Tatami Galaxy S01 1080p BD Remux FLAC-TTGA',
			'The.Tatami.Galaxy.S01.MULTI.VFF.1080p.BluRay.REMUX.LPCM.2.0.AVC-S0L0PURE',
		]);
	});

	// Each first pack holds far more extras than episodes, so its plain median is an
	// extra: 32 MB for the UTR complete series (episodes 3.5-5.5 GB) and 403 MB for
	// MeM.GP (episodes 12-23 GB). The median of the season's largest N videos is the
	// episode size.
	it.each([
		{ fixture: gameOfThrones, imdbId: 'tt0944947', episodes: 10 },
		{ fixture: lastOfUs, imdbId: 'tt3581920', episodes: 7 },
	])(
		'ranks $imdbId packs on their largest $episodes videos, so extras do not sink them',
		async ({ fixture, imdbId, episodes }) => {
			mockCheckAvailability.mockResolvedValue({ available: fixture.available } as any);
			const { setter, getState } = createStateHarness(
				fixture.available.map((t) => ({
					hash: t.hash,
					title: t.title,
					noVideos: false,
					rdAvailable: false,
					files: [],
					fileSize: t.bytes / MB,
					medianFileSize: 0,
					biggestFileSize: 0,
					videoCount: 0,
				})) as any[]
			);

			await checkDatabaseAvailabilityRd(
				'problem',
				'solution',
				imdbId,
				fixture.available.map((t) => t.hash),
				setter,
				identity
			);

			expect(sortByMedian([...getState()], episodes).map((r) => r.title)).toEqual(
				fixture.available.map((t) => t.title)
			);
		}
	);

	// A pack of several seasons on the season 1 page: its largest few videos are
	// double episodes and finales, so ranked on season 1's count it outranks a single
	// season with bigger episodes. The Office's S01-S09 remux read 9.6 GB against the
	// Extended Cut's 6.4 GB episodes (its own are 4.8 GB); Game of Thrones' S01-S08
	// UHD remux read 33 GB against SHD13's 29 GB (its own are 26 GB).
	const checked = async (fixture: { imdbId: string; available: any[] }) => {
		mockCheckAvailability.mockResolvedValue({ available: fixture.available } as any);
		const { setter, getState } = createStateHarness(
			fixture.available.map((t) => ({
				hash: t.hash,
				title: t.title,
				noVideos: false,
				rdAvailable: false,
				files: [],
				fileSize: t.bytes / MB,
				medianFileSize: 0,
				biggestFileSize: 0,
				videoCount: 0,
			})) as any[]
		);
		await checkDatabaseAvailabilityRd(
			'problem',
			'solution',
			fixture.imdbId,
			fixture.available.map((t) => t.hash),
			setter,
			identity
		);
		return getState();
	};

	it.each([{ fixture: officeUs }, { fixture: gameOfThronesUhd }])(
		'ranks a $fixture.imdbId pack of several seasons on every season it holds',
		async ({ fixture }) => {
			const counts = fixture.season_episode_counts as unknown as Record<number, number>;
			const sorted = sortByMedian(await checked(fixture), (r) => packEpisodes(r, counts, 1));
			expect(sorted.map((r) => r.title)).toEqual(fixture.available.map((t) => t.title));
		}
	);

	// Seinfeld's complete series holds nine double episodes of 17-22 GB; its season 1
	// episodes are 10.8 GB, the same encode as the season 1 pack beside it.
	it('shows the episode size of a complete series, not its double episodes', async () => {
		const counts = seinfeld.season_episode_counts as unknown as Record<number, number>;
		const [complete, single] = await checked(seinfeld);
		expect(packEpisodes(complete, counts, 1)).toBe(180);
		expect(packEpisodes(single, counts, 1)).toBe(5);
		const gb = (r: SearchResult) => episodeSize(r, packEpisodes(r, counts, 1)) / 1024;
		expect(gb(complete)).toBeCloseTo(gb(single), 0);
	});
});
