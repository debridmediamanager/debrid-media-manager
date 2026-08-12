import { checkCachedStatus } from '@/services/torbox';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkAvailability,
	checkAvailabilityAd,
	checkAvailabilityAdByHashes,
} from './availability';
import {
	checkDatabaseAvailabilityAd,
	checkDatabaseAvailabilityAd2,
	checkDatabaseAvailabilityRd,
	checkDatabaseAvailabilityTb,
} from './instantChecks';

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

	it('does not invent a fileSize on hashlist torrents', async () => {
		mockCheckAvailabilityAdByHashes.mockResolvedValue({
			available: [
				{
					hash: 'hash-hashlist',
					files: [{ file_id: 0, path: 'Movie.mkv', bytes: 8 * MB }],
				},
			],
		} as any);
		const { setter, getState } = createStateHarness([
			{
				hash: 'hash-hashlist',
				noVideos: false,
				adAvailable: false,
				files: [],
				bytes: 8 * MB,
			},
		] as any[]);

		await checkDatabaseAvailabilityAd2('problem', 'solution', ['hash-hashlist'], setter);

		expect(getState()[0].adAvailable).toBe(true);
		expect(getState()[0]).not.toHaveProperty('fileSize');
	});
});
