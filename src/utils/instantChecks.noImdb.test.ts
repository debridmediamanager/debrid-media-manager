import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkAvailability,
	checkAvailabilityAd,
	checkAvailabilityAdByHashes,
	checkAvailabilityByHashes,
} from './availability';
import { checkDatabaseAvailabilityAd, checkDatabaseAvailabilityRd } from './instantChecks';

// Its own file: instantChecks rate-limits RD lookups to ten per ten seconds
// in module state, and instantChecks.test.ts already spends that budget.

vi.mock('./availability', () => ({
	checkAvailabilityByHashes: vi.fn(),
	checkAvailability: vi.fn(),
	checkAvailabilityAd: vi.fn(),
	checkAvailabilityAdByHashes: vi.fn(),
}));
vi.mock('@/services/torbox', () => ({ checkCachedStatus: vi.fn() }));
vi.mock('@/services/premiumize', () => ({ checkPremiumizeCache: vi.fn() }));
vi.mock('@/services/offcloud', () => ({ checkOffcloudCache: vi.fn() }));
vi.mock('react-hot-toast', () => ({
	toast: { promise: vi.fn((p) => p), success: vi.fn(), loading: vi.fn(), error: vi.fn() },
}));
vi.mock('@/utils/selectable', () => ({
	isVideo: ({ path }: { path: string }) => path.endsWith('.mkv'),
}));

const harness = <T extends { hash: string }>(initial: T[]) => {
	let state = [...initial];
	const setter = vi.fn((updater: ((prev: T[]) => T[]) | T[]) => {
		state = typeof updater === 'function' ? updater(state) : updater;
		return state;
	});
	return { setter, getState: () => state };
};
const identity = (r: any[]) => r;

// An anime entry with no IMDb id asks with ''. /api/availability/check answers
// anything but a tt id with a 400, which used to fail the whole lookup; asking
// by hash finds the rows whichever show page filed them.
describe('database availability without an IMDb id', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([[''], ['anime:anidb-17052']])('asks RD by hash alone for the id %j', async (id) => {
		vi.mocked(checkAvailabilityByHashes).mockResolvedValue({
			available: [
				{ hash: 'hash-anime', files: [{ file_id: 1, path: 'Ep 01.mkv', bytes: 4096 }] },
			],
		} as any);
		const { setter, getState } = harness([
			{ hash: 'hash-anime', noVideos: false, rdAvailable: false, files: [] },
		] as any[]);

		const hits = await checkDatabaseAvailabilityRd(
			'problem',
			'solution',
			id,
			['hash-anime'],
			setter,
			identity
		);

		expect(checkAvailability).not.toHaveBeenCalled();
		expect(checkAvailabilityByHashes).toHaveBeenCalledWith('problem', 'solution', [
			'hash-anime',
		]);
		expect(hits).toBe(1);
		expect(getState()[0].rdAvailable).toBe(true);
	});

	it('asks AD by hash alone', async () => {
		vi.mocked(checkAvailabilityAdByHashes).mockResolvedValue({
			available: [
				{ hash: 'hash-anime', files: [{ file_id: 1, path: 'Ep 01.mkv', bytes: 2048 }] },
			],
		} as any);
		const { setter, getState } = harness([
			{ hash: 'hash-anime', noVideos: false, adAvailable: false, files: [] },
		] as any[]);

		const hits = await checkDatabaseAvailabilityAd(
			'problem',
			'solution',
			'',
			['hash-anime'],
			setter,
			identity
		);

		expect(checkAvailabilityAd).not.toHaveBeenCalled();
		expect(checkAvailabilityAdByHashes).toHaveBeenCalledWith('problem', 'solution', [
			'hash-anime',
		]);
		expect(hits).toBe(1);
		expect(getState()[0].adAvailable).toBe(true);
	});

	it('still scopes the lookup by a real IMDb id', async () => {
		vi.mocked(checkAvailability).mockResolvedValue({ available: [] } as any);
		const { setter } = harness([{ hash: 'h', noVideos: false, files: [] }] as any[]);

		await checkDatabaseAvailabilityRd(
			'problem',
			'solution',
			'tt10885406',
			['h'],
			setter,
			identity
		);

		expect(checkAvailability).toHaveBeenCalledWith('problem', 'solution', 'tt10885406', ['h']);
		expect(checkAvailabilityByHashes).not.toHaveBeenCalled();
	});
});
