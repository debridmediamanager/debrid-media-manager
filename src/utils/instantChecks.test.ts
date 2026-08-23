import { checkPremiumizeCache } from '@/services/premiumize';
import { checkCachedStatus } from '@/services/torbox';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkAvailability,
	checkAvailabilityAd,
	checkAvailabilityAdByHashes,
	checkAvailabilityByHashes,
} from './availability';
import {
	checkAvailabilityPm,
	checkAvailabilityPm2,
	checkDatabaseAvailabilityAd,
	checkDatabaseAvailabilityAd2,
	checkDatabaseAvailabilityRd,
	checkDatabaseAvailabilityRd2,
	checkDatabaseAvailabilityTb,
	checkDatabaseAvailabilityTb2,
	wrapLoading,
} from './instantChecks';

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

vi.mock('react-hot-toast', () => {
	const promise = vi.fn((p) => p);
	const success = vi.fn();
	const loading = vi.fn(() => 'toast-id');
	const error = vi.fn();
	return {
		toast: {
			promise,
			success,
			loading,
			error,
		},
	};
});

vi.mock('@/utils/selectable', () => ({
	isVideo: ({ path }: { path: string }) => path.endsWith('.mkv'),
}));

const mockCheckAvailabilityByHashes = vi.mocked(checkAvailabilityByHashes);
const mockCheckAvailability = vi.mocked(checkAvailability);
const mockCheckAvailabilityAd = vi.mocked(checkAvailabilityAd);
const mockCheckAvailabilityAdByHashes = vi.mocked(checkAvailabilityAdByHashes);
const mockCheckCachedStatus = vi.mocked(checkCachedStatus);
const mockCheckPremiumizeCache = vi.mocked(checkPremiumizeCache);

const createStateHarness = <T extends { hash: string }>(initial: T[]) => {
	let state = [...initial];
	const setter = vi.fn((updater: ((prev: T[]) => T[]) | T[]) => {
		state = typeof updater === 'function' ? updater(state) : updater;
		return state;
	});
	return {
		getState: () => state,
		setter,
	};
};

describe('instantChecks utilities', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('marks RD torrents as available when instant cache hits', async () => {
		mockCheckAvailabilityByHashes.mockResolvedValue({
			available: [
				{
					hash: 'hash-1',
					files: [{ file_id: 1, path: 'Movie.mkv', bytes: 2048 }],
				},
			],
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'hash-1',
				noVideos: false,
				rdAvailable: false,
				files: [],
			},
		] as any[]);

		const instantHits = await checkDatabaseAvailabilityRd2(
			'problem',
			'solution',
			'rd-key',
			['hash-1'],
			setter
		);

		expect(instantHits).toBe(1);
		expect(getState()[0].rdAvailable).toBe(true);
		expect(getState()[0].files).toHaveLength(1);
	});

	it('marks AD torrents as available from the hash-only database check', async () => {
		mockCheckAvailabilityAdByHashes.mockResolvedValue({
			available: [
				{
					hash: 'hash-ad',
					files: [{ file_id: 3, path: 'Episode.mkv', bytes: 1024 }],
				},
			],
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'hash-ad',
				noVideos: false,
				adAvailable: false,
				files: [],
			},
		] as any[]);

		const hits = await checkDatabaseAvailabilityAd2('problem', 'solution', ['hash-ad'], setter);

		expect(hits).toBe(1);
		expect(getState()[0].adAvailable).toBe(true);
		expect(getState()[0].files[0]).toMatchObject({ fileId: 3, filename: 'Episode.mkv' });
	});

	// AllDebrid reports hashes lowercase while hashlists carry them uppercase,
	// so a case-sensitive join would silently mark everything unavailable.
	it('matches AD availability regardless of hash case', async () => {
		mockCheckAvailabilityAdByHashes.mockResolvedValue({
			available: [
				{
					hash: 'abcdef',
					files: [{ file_id: 1, path: 'Episode.mkv', bytes: 1024 }],
				},
			],
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'ABCDEF',
				noVideos: false,
				adAvailable: false,
				files: [],
			},
		] as any[]);

		const hits = await checkDatabaseAvailabilityAd2('problem', 'solution', ['ABCDEF'], setter);

		expect(hits).toBe(1);
		expect(getState()[0].adAvailable).toBe(true);
	});

	it('marks TB torrents as available when cached data exists', async () => {
		mockCheckCachedStatus.mockResolvedValue({
			success: true,
			data: {
				'hash-tb': {
					files: [{ name: 'Show.mkv', size: 2048 }],
				},
			},
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'hash-tb',
				noVideos: false,
				tbAvailable: false,
				files: [],
			},
		] as any[]);

		const hits = await checkDatabaseAvailabilityTb2('tb-key', ['hash-tb'], setter);

		expect(hits).toBe(1);
		expect(getState()[0].tbAvailable).toBe(true);
		expect(getState()[0].files[0]).toMatchObject({ filename: 'Show.mkv' });
	});

	it('wrapLoading proxies toast.promise to surface async results', async () => {
		const asyncCheck = Promise.resolve(3);
		const result = await wrapLoading('RD', asyncCheck);
		expect(result).toBe(3);
	});

	describe('imdb-based availability checks', () => {
		const identity = (r: any[]) => r;

		it('checkDatabaseAvailabilityRd calls checkAvailability with imdbId and marks matching results as rdAvailable', async () => {
			mockCheckAvailability.mockResolvedValue({
				available: [
					{
						hash: 'hash-rd-imdb',
						files: [{ file_id: 1, path: 'Movie.mkv', bytes: 4096 }],
					},
				],
			} as any);
			const { setter, getState } = createStateHarness([
				{
					hash: 'hash-rd-imdb',
					noVideos: false,
					rdAvailable: false,
					files: [],
				},
			] as any[]);

			const hits = await checkDatabaseAvailabilityRd(
				'problem',
				'solution',
				'tt1234567',
				['hash-rd-imdb'],
				setter,
				identity
			);

			expect(mockCheckAvailability).toHaveBeenCalledWith('problem', 'solution', 'tt1234567', [
				'hash-rd-imdb',
			]);
			expect(hits).toBe(1);
			expect(getState()[0].rdAvailable).toBe(true);
			expect(getState()[0].files).toHaveLength(1);
			expect(getState()[0].files[0]).toMatchObject({ filename: 'Movie.mkv', filesize: 4096 });
		});

		it('checkDatabaseAvailabilityAd calls checkAvailabilityAd with imdbId and marks matching results as adAvailable', async () => {
			mockCheckAvailabilityAd.mockResolvedValue({
				available: [
					{
						hash: 'hash-ad-imdb',
						files: [{ file_id: 1, path: 'Episode.mkv', bytes: 2048 }],
					},
				],
			} as any);
			const { setter, getState } = createStateHarness([
				{
					hash: 'hash-ad-imdb',
					noVideos: false,
					adAvailable: false,
					files: [],
				},
			] as any[]);

			const hits = await checkDatabaseAvailabilityAd(
				'problem',
				'solution',
				'tt7654321',
				['hash-ad-imdb'],
				setter,
				identity
			);

			expect(mockCheckAvailabilityAd).toHaveBeenCalledWith(
				'problem',
				'solution',
				'tt7654321',
				['hash-ad-imdb']
			);
			expect(hits).toBe(1);
			expect(getState()[0].adAvailable).toBe(true);
			expect(getState()[0].files).toHaveLength(1);
			expect(getState()[0].files[0]).toMatchObject({
				filename: 'Episode.mkv',
				filesize: 2048,
			});
		});

		it('checkDatabaseAvailabilityTb calls checkCachedStatus and marks matching results as tbAvailable', async () => {
			mockCheckCachedStatus.mockResolvedValue({
				success: true,
				data: {
					'hash-tb-imdb': {
						files: [{ name: 'Show.mkv', size: 3072 }],
					},
				},
			} as any);
			const { setter, getState } = createStateHarness([
				{
					hash: 'hash-tb-imdb',
					noVideos: false,
					tbAvailable: false,
					files: [],
				},
			] as any[]);

			const hits = await checkDatabaseAvailabilityTb(
				'tb-key',
				['hash-tb-imdb'],
				setter,
				identity
			);

			expect(hits).toBe(1);
			expect(getState()[0].tbAvailable).toBe(true);
			expect(getState()[0].files[0]).toMatchObject({ filename: 'Show.mkv', filesize: 3072 });
		});

		it('returns 0 and marks nothing available when checkAvailability returns no matches', async () => {
			mockCheckAvailability.mockResolvedValue({
				available: [],
			} as any);
			const { setter, getState } = createStateHarness([
				{
					hash: 'hash-no-match',
					noVideos: false,
					rdAvailable: false,
					files: [],
				},
			] as any[]);

			const hits = await checkDatabaseAvailabilityRd(
				'problem',
				'solution',
				'tt0000000',
				['hash-no-match'],
				setter,
				identity
			);

			expect(hits).toBe(0);
			expect(getState()[0].rdAvailable).toBe(false);
			expect(getState()[0].files).toHaveLength(0);
		});

		it('skips torrents with noVideos: true', async () => {
			mockCheckAvailability.mockResolvedValue({
				available: [
					{
						hash: 'hash-novideo',
						files: [{ file_id: 1, path: 'Movie.mkv', bytes: 1024 }],
					},
				],
			} as any);
			const { setter, getState } = createStateHarness([
				{
					hash: 'hash-novideo',
					noVideos: true,
					rdAvailable: false,
					files: [],
				},
			] as any[]);

			const hits = await checkDatabaseAvailabilityRd(
				'problem',
				'solution',
				'tt1111111',
				['hash-novideo'],
				setter,
				identity
			);

			expect(hits).toBe(0);
			expect(getState()[0].rdAvailable).toBe(false);
			expect(getState()[0].files).toHaveLength(0);
		});
	});

	describe('batch processing', () => {
		const identity = (r: any[]) => r;

		it('processes all hash batches through rate limiter for RD', async () => {
			const hashes = Array.from({ length: 250 }, (_, i) => `hash-${i}`);
			const torrents = hashes.map((hash) => ({
				hash,
				noVideos: false,
				rdAvailable: false,
				files: [],
			}));

			mockCheckAvailability.mockImplementation(async (_p, _s, _id, hashGroup: string[]) => ({
				available: hashGroup.map((h: string) => ({
					hash: h,
					files: [{ file_id: 1, path: 'Movie.mkv', bytes: 2048 }],
				})),
			}));

			const { setter, getState } = createStateHarness(torrents as any[]);

			const hits = await checkDatabaseAvailabilityRd(
				'problem',
				'solution',
				'tt9999999',
				hashes,
				setter,
				identity
			);

			// 250 hashes / 100 batch size = 3 batches
			expect(mockCheckAvailability).toHaveBeenCalledTimes(3);
			expect(hits).toBe(250);
			expect(getState().every((t: any) => t.rdAvailable)).toBe(true);
		});

		it('processes all hash batches for RD2 (hash-only variant)', async () => {
			const hashes = Array.from({ length: 150 }, (_, i) => `hash-${i}`);
			const torrents = hashes.map((hash) => ({
				hash,
				noVideos: false,
				rdAvailable: false,
				files: [],
			}));

			mockCheckAvailabilityByHashes.mockImplementation(
				async (_p: string, _s: string, hashGroup: string[]) => ({
					available: hashGroup.map((h: string) => ({
						hash: h,
						files: [{ file_id: 1, path: 'Movie.mkv', bytes: 1024 }],
					})),
				})
			);

			const { setter, getState } = createStateHarness(torrents as any[]);

			const hits = await checkDatabaseAvailabilityRd2(
				'problem',
				'solution',
				'rd-key',
				hashes,
				setter
			);

			// 150 hashes / 100 batch size = 2 batches
			expect(mockCheckAvailabilityByHashes).toHaveBeenCalledTimes(2);
			expect(hits).toBe(150);
			expect(getState().every((t: any) => t.rdAvailable)).toBe(true);
		});

		it('handles partial availability across batches', async () => {
			const hashes = ['hash-0', 'hash-1', 'hash-2', 'hash-3'];
			const torrents = hashes.map((hash) => ({
				hash,
				noVideos: false,
				rdAvailable: false,
				files: [],
			}));

			mockCheckAvailability.mockResolvedValue({
				available: [
					{ hash: 'hash-0', files: [{ file_id: 1, path: 'A.mkv', bytes: 1024 }] },
					{ hash: 'hash-2', files: [{ file_id: 1, path: 'B.mkv', bytes: 2048 }] },
				],
			} as any);

			const { setter, getState } = createStateHarness(torrents as any[]);

			const hits = await checkDatabaseAvailabilityRd(
				'problem',
				'solution',
				'tt0000001',
				hashes,
				setter,
				identity
			);

			expect(hits).toBe(2);
			expect(getState()[0].rdAvailable).toBe(true);
			expect(getState()[1].rdAvailable).toBe(false);
			expect(getState()[2].rdAvailable).toBe(true);
			expect(getState()[3].rdAvailable).toBe(false);
		});
	});

	describe('Premiumize', () => {
		const identity = <T>(rows: T[]) => rows;

		it('marks cached hashes available without touching files', async () => {
			// cache/check reports one filename and one size per hash and no file
			// listing, so whatever another service worked out has to survive.
			mockCheckPremiumizeCache.mockResolvedValue([
				{ hash: 'hash-1', cached: true, filename: 'Movie', filesize: 2147483648 },
				{ hash: 'hash-2', cached: false, filename: null, filesize: null },
			]);
			const { setter, getState } = createStateHarness([
				{
					hash: 'hash-1',
					noVideos: false,
					pmAvailable: false,
					files: [{ fileId: 0, filename: 'Movie.mkv', filesize: 5 }],
					fileSize: 1024,
					medianFileSize: 1024,
					videoCount: 1,
				},
				{ hash: 'hash-2', noVideos: false, pmAvailable: false, files: [] },
			] as any[]);

			const hits = await checkAvailabilityPm(
				'pm-key',
				['hash-1', 'hash-2'],
				setter,
				identity
			);

			expect(hits).toBe(1);
			expect(getState()[0].pmAvailable).toBe(true);
			expect(getState()[0].files).toHaveLength(1);
			expect(getState()[0].fileSize).toBe(1024);
			expect(getState()[1].pmAvailable).toBe(false);
		});

		it('repairs a missing size from the cache probe', async () => {
			mockCheckPremiumizeCache.mockResolvedValue([
				{ hash: 'hash-1', cached: true, filename: 'Movie', filesize: 2147483648 },
			]);
			const { setter, getState } = createStateHarness([
				{
					hash: 'hash-1',
					noVideos: false,
					pmAvailable: false,
					files: [],
					fileSize: 0,
					medianFileSize: 0,
					videoCount: 0,
				},
			] as any[]);

			await checkAvailabilityPm('pm-key', ['hash-1'], setter, identity);

			expect(getState()[0].fileSize).toBeCloseTo(2048, 5);
		});

		it('matches case-insensitively, because the probe echoes what it was sent', async () => {
			mockCheckPremiumizeCache.mockResolvedValue([
				{ hash: 'AABBCC', cached: true, filename: 'Show', filesize: 10 },
			]);
			const { setter, getState } = createStateHarness([
				{ hash: 'aabbcc', noVideos: false, pmAvailable: false, files: [] },
			] as any[]);

			expect(await checkAvailabilityPm2('pm-key', ['AABBCC'], setter)).toBe(1);
			expect(getState()[0].pmAvailable).toBe(true);
		});

		it('leaves a row with no videos alone', async () => {
			mockCheckPremiumizeCache.mockResolvedValue([
				{ hash: 'hash-1', cached: true, filename: 'Archive', filesize: 10 },
			]);
			const { setter, getState } = createStateHarness([
				{ hash: 'hash-1', noVideos: true, pmAvailable: false, files: [] },
			] as any[]);

			expect(await checkAvailabilityPm2('pm-key', ['hash-1'], setter)).toBe(0);
			expect(getState()[0].pmAvailable).toBe(false);
		});

		it('does not re-render when nothing is cached', async () => {
			mockCheckPremiumizeCache.mockResolvedValue([
				{ hash: 'hash-1', cached: false, filename: null, filesize: null },
			]);
			const { setter } = createStateHarness([
				{ hash: 'hash-1', noVideos: false, pmAvailable: false, files: [] },
			] as any[]);

			expect(await checkAvailabilityPm2('pm-key', ['hash-1'], setter)).toBe(0);
			expect(setter).not.toHaveBeenCalled();
		});
	});
});
