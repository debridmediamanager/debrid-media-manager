import { adInstantCheck } from '@/services/allDebrid';
import { checkCachedStatus } from '@/services/torbox';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAvailability, checkAvailabilityAd, checkAvailabilityByHashes } from './availability';
import {
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
}));

vi.mock('@/services/allDebrid', () => ({
	adInstantCheck: vi.fn(),
}));

vi.mock('@/services/torbox', () => ({
	checkCachedStatus: vi.fn(),
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
const mockAdInstantCheck = vi.mocked(adInstantCheck);
const mockCheckCachedStatus = vi.mocked(checkCachedStatus);

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

	it('marks AD torrents as available when magnets indicate instant status', async () => {
		mockAdInstantCheck.mockResolvedValue({
			data: {
				magnets: [
					{
						hash: 'hash-ad',
						instant: true,
						files: [{ n: 'Episode.mkv', s: 1024 }],
					},
				],
			},
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'hash-ad',
				noVideos: false,
				adAvailable: false,
				files: [],
			},
		] as any[]);

		const hits = await checkDatabaseAvailabilityAd2('ad-key', ['hash-ad'], setter);

		expect(hits).toBe(1);
		expect(getState()[0].adAvailable).toBe(true);
		expect(getState()[0].files[0]).toMatchObject({ filename: 'Episode.mkv' });
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
});
