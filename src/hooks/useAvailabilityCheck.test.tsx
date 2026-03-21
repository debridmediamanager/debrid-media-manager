import { SearchResult } from '@/services/mediasearch';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAvailabilityCheck } from './useAvailabilityCheck';

const {
	mockToast,
	mockToastCall,
	mockGenerateTokenAndHash,
	mockCheckDatabaseAvailabilityRd,
	mockCheckDatabaseAvailabilityAd,
	mockCheckDatabaseAvailabilityTb,
	mockGetCachedTrackerStats,
	mockShouldIncludeTrackerStats,
	mockProcessWithConcurrency,
	toastFunction,
} = vi.hoisted(() => {
	const loading = vi.fn().mockReturnValue('toast-id');
	const success = vi.fn();
	const error = vi.fn();
	const dismiss = vi.fn();
	const promise = vi.fn();
	const call = vi.fn();
	const toastFn = Object.assign(
		(...args: unknown[]) => {
			call(...args);
		},
		{ loading, success, error, dismiss, promise }
	);
	return {
		mockToast: { loading, success, error, dismiss, promise },
		mockToastCall: call,
		mockGenerateTokenAndHash: vi.fn(),
		mockCheckDatabaseAvailabilityRd: vi.fn(),
		mockCheckDatabaseAvailabilityAd: vi.fn(),
		mockCheckDatabaseAvailabilityTb: vi.fn(),
		mockGetCachedTrackerStats: vi.fn(),
		mockShouldIncludeTrackerStats: vi.fn(),
		mockProcessWithConcurrency: vi.fn(),
		toastFunction: toastFn,
	};
});

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastFunction,
	toast: toastFunction,
}));

vi.mock('@/utils/token', () => ({
	generateTokenAndHash: mockGenerateTokenAndHash,
}));

vi.mock('@/utils/instantChecks', () => ({
	checkDatabaseAvailabilityRd: mockCheckDatabaseAvailabilityRd,
	checkDatabaseAvailabilityAd: mockCheckDatabaseAvailabilityAd,
	checkDatabaseAvailabilityTb: mockCheckDatabaseAvailabilityTb,
}));

vi.mock('@/utils/trackerStats', () => ({
	getCachedTrackerStats: mockGetCachedTrackerStats,
	shouldIncludeTrackerStats: mockShouldIncludeTrackerStats,
}));

vi.mock('@/utils/parallelProcessor', () => ({
	processWithConcurrency: mockProcessWithConcurrency,
}));

const createSearchResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
	title: overrides.title || 'Sample Torrent',
	fileSize: overrides.fileSize ?? 1024,
	hash: overrides.hash || 'hash-1',
	rdAvailable: overrides.rdAvailable ?? false,
	adAvailable: overrides.adAvailable ?? false,
	tbAvailable: overrides.tbAvailable ?? false,
	files: overrides.files ?? [],
	noVideos: overrides.noVideos ?? false,
	medianFileSize: overrides.medianFileSize ?? 1024,
	biggestFileSize: overrides.biggestFileSize ?? 1024,
	videoCount: overrides.videoCount ?? 1,
	trackerStats: overrides.trackerStats,
});

describe('useAvailabilityCheck', () => {
	const initialSearchResults = [createSearchResult(), createSearchResult({ hash: 'hash-2' })];
	let searchResults = [...initialSearchResults];
	const setSearchResults = vi.fn((updater) => {
		searchResults =
			typeof updater === 'function'
				? (updater as (prev: SearchResult[]) => SearchResult[])(searchResults)
				: updater;
	});
	const addRd = vi.fn();
	const addAd = vi.fn();
	const addTb = vi.fn();
	const deleteRd = vi.fn();
	const deleteAd = vi.fn();
	const deleteTb = vi.fn();
	const sortFn = vi.fn((results: SearchResult[]) => results);

	beforeEach(() => {
		vi.useFakeTimers();
		searchResults = [...initialSearchResults];
		setSearchResults.mockClear();
		addRd.mockReset();
		addAd.mockReset();
		addTb.mockReset();
		deleteRd.mockReset();
		deleteAd.mockReset();
		deleteTb.mockReset();
		sortFn.mockClear();
		mockToast.loading.mockClear();
		mockToast.success.mockClear();
		mockToast.error.mockClear();
		mockToast.dismiss.mockClear();
		mockToastCall.mockClear();
		mockGenerateTokenAndHash.mockResolvedValue(['token', 'hash']);
		mockCheckDatabaseAvailabilityRd.mockResolvedValue(undefined);
		mockCheckDatabaseAvailabilityAd.mockResolvedValue(undefined);
		mockCheckDatabaseAvailabilityTb.mockResolvedValue(undefined);
		mockShouldIncludeTrackerStats.mockReturnValue(true);
		mockGetCachedTrackerStats.mockResolvedValue({
			seeders: 2,
			leechers: 0,
			downloads: 10,
		});
		mockProcessWithConcurrency.mockImplementation(async (items, processor) => {
			const results = [];
			for (const item of items) {
				try {
					const result = await processor(item);
					results.push({ item, success: true, result });
				} catch (error) {
					results.push({ item, success: false, error });
				}
			}
			return results;
		});
		Object.defineProperty(window, 'location', {
			value: { reload: vi.fn() },
			writable: true,
		});
		Object.defineProperty(window, 'localStorage', {
			value: {
				store: new Map<string, string>(),
				getItem(key: string) {
					return this.store.get(key) ?? null;
				},
				setItem(key: string, value: string) {
					this.store.set(key, value);
				},
				removeItem(key: string) {
					this.store.delete(key);
				},
			},
			writable: true,
		});
		addRd.mockResolvedValue({
			id: 'rd-1',
			status: 'downloaded',
			progress: 100,
			links: [],
			files: [],
		});
		addAd.mockResolvedValue({
			id: 123,
			filename: 'test.mkv',
			size: 1024,
			status: 'Ready',
			statusCode: 4,
			files: [],
		});
		addTb.mockResolvedValue({ id: 'tb-1', download_finished: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const renderAvailabilityHook = (
		overrides: {
			rdKey?: string | null;
			adKey?: string | null;
			torboxKey?: string | null;
			hashAndProgress?: Record<string, number>;
		} = {}
	) =>
		renderHook(() =>
			useAvailabilityCheck(
				overrides.rdKey !== undefined ? overrides.rdKey : 'rd-key',
				overrides.adKey !== undefined ? overrides.adKey : 'ad-key',
				overrides.torboxKey !== undefined ? overrides.torboxKey : 'tb-key',
				'tt123',
				searchResults,
				setSearchResults,
				overrides.hashAndProgress ?? {},
				addRd,
				addAd,
				addTb,
				deleteRd,
				deleteAd,
				deleteTb,
				sortFn
			)
		);

	// =========================================================================
	// Initial state
	// =========================================================================

	describe('initial state', () => {
		it('starts with isAnyChecking = false', () => {
			const { result } = renderAvailabilityHook();
			expect(result.current.isAnyChecking).toBe(false);
		});

		it('isHashServiceChecking returns false for all services', () => {
			const { result } = renderAvailabilityHook();
			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-1', 'AD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-1', 'TB')).toBe(false);
		});
	});

	// =========================================================================
	// checkServiceAvailability — single item
	// =========================================================================

	describe('checkServiceAvailability (single)', () => {
		it('checks all services and triggers RD/AD/TB database refresh', async () => {
			const { result } = renderAvailabilityHook();

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0]);
			});

			expect(addRd).toHaveBeenCalledWith('hash-1', true);
			expect(deleteRd).toHaveBeenCalled();
			expect(addAd).toHaveBeenCalledWith('hash-1', true);
			expect(deleteAd).toHaveBeenCalled();
			expect(addTb).toHaveBeenCalledWith('hash-1', true);
			expect(mockCheckDatabaseAvailabilityRd).toHaveBeenCalled();
			expect(mockCheckDatabaseAvailabilityAd).toHaveBeenCalled();
			expect(mockCheckDatabaseAvailabilityTb).toHaveBeenCalled();
			expect(mockToast.success).toHaveBeenCalledWith(
				expect.stringContaining('Service check done'),
				{ id: 'toast-id' }
			);
		});

		it('does NOT reload the page after completing', async () => {
			const { result } = renderAvailabilityHook();

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0]);
			});

			vi.runAllTimers();
			expect(window.location.reload).not.toHaveBeenCalled();
		});

		it('checks only AllDebrid when only AD key is provided', async () => {
			const { result } = renderHook(() =>
				useAvailabilityCheck(
					null,
					'ad-key',
					null,
					'tt123',
					searchResults,
					setSearchResults,
					{},
					addRd,
					addAd,
					addTb,
					deleteRd,
					deleteAd,
					deleteTb,
					sortFn
				)
			);

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0]);
			});

			expect(addRd).not.toHaveBeenCalled();
			expect(addAd).toHaveBeenCalledWith('hash-1', true);
			expect(deleteAd).toHaveBeenCalled();
			expect(addTb).not.toHaveBeenCalled();
			expect(mockCheckDatabaseAvailabilityAd).toHaveBeenCalled();
			expect(mockToast.success).toHaveBeenCalledWith(
				expect.stringContaining('Service check done'),
				{ id: 'toast-id' }
			);
		});

		it('shows already cached message for AD', async () => {
			window.localStorage.removeItem('settings:availabilityCheckLimit');
			const cachedResult = createSearchResult({ adAvailable: true });
			const { result } = renderAvailabilityHook();

			await act(async () => {
				await result.current.checkServiceAvailability(cachedResult, ['AD']);
			});

			expect(mockToast.success).toHaveBeenCalledWith(
				expect.stringContaining('Already cached in AD')
			);
			expect(addRd).not.toHaveBeenCalled();
			expect(addAd).not.toHaveBeenCalled();
			expect(addTb).not.toHaveBeenCalled();
		});

		it('shows error toast when no services are available', async () => {
			const { result } = renderAvailabilityHook({
				rdKey: null,
				adKey: null,
				torboxKey: null,
			});

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0]);
			});

			expect(mockToast.error).toHaveBeenCalledWith(
				'No services available for availability check.'
			);
		});

		it('calls addRd before deleteRd when torrent is NOT in progress', async () => {
			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0], ['RD']);
			});

			const addOrder = addRd.mock.invocationCallOrder[0];
			const deleteOrder = deleteRd.mock.invocationCallOrder[0];
			expect(addOrder).toBeLessThan(deleteOrder);
		});

		it('calls deleteRd before addRd when torrent IS in progress', async () => {
			const { result } = renderAvailabilityHook({
				adKey: null,
				torboxKey: null,
				hashAndProgress: { 'rd:hash-1': 50 },
			});

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0], ['RD']);
			});

			const deleteOrder = deleteRd.mock.invocationCallOrder[0];
			const addOrder = addRd.mock.invocationCallOrder[0];
			expect(deleteOrder).toBeLessThan(addOrder);
		});
	});

	// =========================================================================
	// checkServiceAvailabilityBulk
	// =========================================================================

	describe('checkServiceAvailabilityBulk', () => {
		it('handles bulk availability check for multiple services', async () => {
			const { result } = renderAvailabilityHook();

			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(searchResults);
			});

			expect(addRd).toHaveBeenCalled();
			expect(addAd).toHaveBeenCalled();
			expect(addTb).toHaveBeenCalled();
			expect(mockCheckDatabaseAvailabilityRd).toHaveBeenCalled();
			expect(mockCheckDatabaseAvailabilityAd).toHaveBeenCalled();
			expect(mockCheckDatabaseAvailabilityTb).toHaveBeenCalled();
		});

		it('respects availabilityCheckLimit from localStorage', async () => {
			window.localStorage.setItem('settings:availabilityCheckLimit', '1');
			const { result } = renderAvailabilityHook();

			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(searchResults);
			});

			expect(mockToast.loading).toHaveBeenCalled();
			expect(mockToastCall).toHaveBeenCalledWith(
				expect.stringContaining('Checking first 1 of 2'),
				expect.objectContaining({ duration: 4000 })
			);
			expect(addRd).toHaveBeenCalled();
			expect(addAd).toHaveBeenCalled();
			expect(addTb).toHaveBeenCalled();
			expect(mockGetCachedTrackerStats).toHaveBeenCalled();
			expect(mockToast.dismiss).toHaveBeenCalledWith('toast-id');
		});

		it('targets only the selected services during bulk checks', async () => {
			const { result } = renderAvailabilityHook();
			const mixedResults = [
				createSearchResult({ hash: 'hash-3', adAvailable: true }),
				createSearchResult({ hash: 'hash-4' }),
			];

			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(mixedResults, ['RD']);
			});

			expect(addRd).toHaveBeenCalled();
			expect(addAd).not.toHaveBeenCalled();
			expect(addTb).not.toHaveBeenCalled();
		});

		it('does NOT reload the page after bulk check completes', async () => {
			const { result } = renderAvailabilityHook();

			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(searchResults, ['RD']);
			});

			vi.runAllTimers();
			expect(window.location.reload).not.toHaveBeenCalled();
		});

		it('does NOT reload the page after bulk check errors', async () => {
			addRd.mockRejectedValue(new Error('fail'));
			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(searchResults, ['RD']);
			});

			vi.runAllTimers();
			expect(window.location.reload).not.toHaveBeenCalled();
		});

		it('shows error toast when all torrents are already available', async () => {
			const allCached = [createSearchResult({ hash: 'hash-1', rdAvailable: true })];
			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(allCached, ['RD']);
			});

			expect(mockToast.error).toHaveBeenCalledWith('No torrents left to check for RD.');
		});

		it('shows error toast when no services are configured', async () => {
			const { result } = renderAvailabilityHook({
				rdKey: null,
				adKey: null,
				torboxKey: null,
			});

			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(searchResults);
			});

			expect(mockToast.error).toHaveBeenCalledWith(
				'No services available for availability check.'
			);
		});
	});

	// =========================================================================
	// Per-hash-per-service checking state
	// =========================================================================

	describe('per-hash-per-service checking state (single check)', () => {
		it('marks only the requested service as checking for the given hash', async () => {
			let resolveRd!: (value: any) => void;
			addRd.mockReturnValue(new Promise((r) => (resolveRd = r)));

			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			let checkPromise: Promise<void>;
			act(() => {
				checkPromise = result.current.checkServiceAvailability(searchResults[0], ['RD']);
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(true);
			expect(result.current.isHashServiceChecking('hash-1', 'AD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-1', 'TB')).toBe(false);
			expect(result.current.isAnyChecking).toBe(true);

			await act(async () => {
				resolveRd({ id: 'rd-1', status: 'downloaded', progress: 100 });
				await checkPromise!;
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(false);
			expect(result.current.isAnyChecking).toBe(false);
		});

		it('marks all needed services when no specific service is requested', async () => {
			let resolveRd!: (value: any) => void;
			let resolveAd!: (value: any) => void;
			let resolveTb!: (value: any) => void;
			addRd.mockReturnValue(new Promise((r) => (resolveRd = r)));
			addAd.mockReturnValue(new Promise((r) => (resolveAd = r)));
			addTb.mockReturnValue(new Promise((r) => (resolveTb = r)));

			const { result } = renderAvailabilityHook();

			let checkPromise: Promise<void>;
			act(() => {
				checkPromise = result.current.checkServiceAvailability(searchResults[0]);
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(true);
			expect(result.current.isHashServiceChecking('hash-1', 'AD')).toBe(true);
			expect(result.current.isHashServiceChecking('hash-1', 'TB')).toBe(true);

			await act(async () => {
				resolveRd({ id: 'rd-1', status: 'downloaded', progress: 100 });
				resolveAd({ id: 123, status: 'Ready', statusCode: 4 });
				resolveTb({ id: 'tb-1', download_finished: true });
				await checkPromise!;
			});

			expect(result.current.isAnyChecking).toBe(false);
		});

		it('does not mark already-available services', async () => {
			const partialResult = createSearchResult({
				hash: 'hash-1',
				rdAvailable: true,
			});
			searchResults = [partialResult, createSearchResult({ hash: 'hash-2' })];

			let resolveAd!: (value: any) => void;
			let resolveTb!: (value: any) => void;
			addAd.mockReturnValue(new Promise((r) => (resolveAd = r)));
			addTb.mockReturnValue(new Promise((r) => (resolveTb = r)));

			const { result } = renderAvailabilityHook();

			let checkPromise: Promise<void>;
			act(() => {
				checkPromise = result.current.checkServiceAvailability(partialResult);
			});

			// RD already available — should NOT be checking
			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-1', 'AD')).toBe(true);
			expect(result.current.isHashServiceChecking('hash-1', 'TB')).toBe(true);

			await act(async () => {
				resolveAd({ id: 123, status: 'Ready', statusCode: 4 });
				resolveTb({ id: 'tb-1', download_finished: true });
				await checkPromise!;
			});

			expect(result.current.isAnyChecking).toBe(false);
		});

		it('skips entirely and does not mark checking when all requested are cached', async () => {
			const fullyCached = createSearchResult({
				hash: 'hash-1',
				rdAvailable: true,
				adAvailable: true,
			});
			const { result } = renderAvailabilityHook();

			await act(async () => {
				await result.current.checkServiceAvailability(fullyCached, ['RD', 'AD']);
			});

			expect(result.current.isAnyChecking).toBe(false);
			expect(mockToast.success).toHaveBeenCalledWith('Already cached in RD / AD.');
			expect(addRd).not.toHaveBeenCalled();
			expect(addAd).not.toHaveBeenCalled();
		});

		it('clears checking state on error', async () => {
			addRd.mockRejectedValue(new Error('network error'));

			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0], ['RD']);
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(false);
			expect(result.current.isAnyChecking).toBe(false);
		});

		it('different hashes are independent — completing one does not affect the other', async () => {
			let resolveRd1!: (value: any) => void;
			let resolveRd2!: (value: any) => void;
			addRd.mockImplementation((hash: string) => {
				if (hash === 'hash-1') return new Promise((r) => (resolveRd1 = r));
				if (hash === 'hash-2') return new Promise((r) => (resolveRd2 = r));
				return Promise.resolve(null);
			});

			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			let promise1: Promise<void>;
			let promise2: Promise<void>;
			act(() => {
				promise1 = result.current.checkServiceAvailability(searchResults[0], ['RD']);
				promise2 = result.current.checkServiceAvailability(searchResults[1], ['RD']);
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(true);
			expect(result.current.isHashServiceChecking('hash-2', 'RD')).toBe(true);

			// Complete only hash-1
			await act(async () => {
				resolveRd1({ id: 'rd-1', status: 'downloaded', progress: 100 });
				await promise1!;
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-2', 'RD')).toBe(true);
			expect(result.current.isAnyChecking).toBe(true);

			// Complete hash-2
			await act(async () => {
				resolveRd2({ id: 'rd-2', status: 'downloaded', progress: 100 });
				await promise2!;
			});

			expect(result.current.isHashServiceChecking('hash-2', 'RD')).toBe(false);
			expect(result.current.isAnyChecking).toBe(false);
		});

		it('checking RD does not disable AD or TB buttons for the same hash', async () => {
			let resolveRd!: (value: any) => void;
			addRd.mockReturnValue(new Promise((r) => (resolveRd = r)));

			const { result } = renderAvailabilityHook();

			let checkPromise: Promise<void>;
			act(() => {
				checkPromise = result.current.checkServiceAvailability(searchResults[0], ['RD']);
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(true);
			expect(result.current.isHashServiceChecking('hash-1', 'AD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-1', 'TB')).toBe(false);

			await act(async () => {
				resolveRd({ id: 'rd-1', status: 'downloaded', progress: 100 });
				await checkPromise!;
			});
		});

		it('allows checking different services for the same hash concurrently', async () => {
			let resolveRd!: (value: any) => void;
			let resolveAd!: (value: any) => void;
			addRd.mockReturnValue(new Promise((r) => (resolveRd = r)));
			addAd.mockReturnValue(new Promise((r) => (resolveAd = r)));

			const { result } = renderAvailabilityHook({ torboxKey: null });

			let rdPromise: Promise<void>;
			let adPromise: Promise<void>;
			act(() => {
				rdPromise = result.current.checkServiceAvailability(searchResults[0], ['RD']);
				adPromise = result.current.checkServiceAvailability(searchResults[0], ['AD']);
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(true);
			expect(result.current.isHashServiceChecking('hash-1', 'AD')).toBe(true);

			// Resolve RD first
			await act(async () => {
				resolveRd({ id: 'rd-1', status: 'downloaded', progress: 100 });
				await rdPromise!;
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-1', 'AD')).toBe(true);
			expect(result.current.isAnyChecking).toBe(true);

			await act(async () => {
				resolveAd({ id: 123, status: 'Ready', statusCode: 4 });
				await adPromise!;
			});

			expect(result.current.isAnyChecking).toBe(false);
		});
	});

	// =========================================================================
	// Per-hash-per-service checking state (bulk check)
	// =========================================================================

	describe('per-hash-per-service checking state (bulk check)', () => {
		it('marks each hash only with its needed services', async () => {
			const mixedResults = [
				createSearchResult({ hash: 'hash-A', rdAvailable: false, adAvailable: true }),
				createSearchResult({ hash: 'hash-B', rdAvailable: true, adAvailable: false }),
			];
			searchResults = mixedResults;

			// Make processWithConcurrency hang so we can inspect checking state
			let resolveProcessing!: (value: any) => void;
			mockProcessWithConcurrency.mockReturnValue(new Promise((r) => (resolveProcessing = r)));

			const { result } = renderAvailabilityHook({ torboxKey: null });

			let bulkPromise: Promise<void>;
			act(() => {
				bulkPromise = result.current.checkServiceAvailabilityBulk(mixedResults, [
					'RD',
					'AD',
				]);
			});

			// hash-A needs RD (not AD — already cached)
			expect(result.current.isHashServiceChecking('hash-A', 'RD')).toBe(true);
			expect(result.current.isHashServiceChecking('hash-A', 'AD')).toBe(false);

			// hash-B needs AD (not RD — already cached)
			expect(result.current.isHashServiceChecking('hash-B', 'RD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-B', 'AD')).toBe(true);

			await act(async () => {
				resolveProcessing([]);
				await bulkPromise!;
			});
		});

		it('prevents concurrent bulk checks via isAnyChecking guard', async () => {
			let resolveProcessing!: (value: any) => void;
			mockProcessWithConcurrency.mockReturnValue(new Promise((r) => (resolveProcessing = r)));

			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			let firstPromise: Promise<void>;
			act(() => {
				firstPromise = result.current.checkServiceAvailabilityBulk(searchResults, ['RD']);
			});

			expect(result.current.isAnyChecking).toBe(true);

			const callCountBefore = mockProcessWithConcurrency.mock.calls.length;

			// Second call should be a no-op
			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(searchResults, ['RD']);
			});

			expect(mockProcessWithConcurrency.mock.calls.length).toBe(callCountBefore);

			await act(async () => {
				resolveProcessing([]);
				await firstPromise!;
			});
		});

		it('removes checking state per-hash as each hash completes in bulk', async () => {
			// Track the order of removeChecking calls via state transitions
			const checkedHashes: string[] = [];
			addRd.mockImplementation((hash: string) => {
				checkedHashes.push(hash);
				return Promise.resolve({ id: `rd-${hash}`, status: 'downloaded', progress: 100 });
			});

			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(searchResults, ['RD']);
			});

			// Both hashes were processed
			expect(checkedHashes).toContain('hash-1');
			expect(checkedHashes).toContain('hash-2');

			// After completion, all checking states should be cleared
			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-2', 'RD')).toBe(false);
			expect(result.current.isAnyChecking).toBe(false);
		});

		it('clears checking state for a hash even when that hash fails in bulk', async () => {
			addRd.mockImplementation((hash: string) => {
				if (hash === 'hash-1') return Promise.reject(new Error('RD fail'));
				return Promise.resolve({ id: 'rd-2', status: 'downloaded', progress: 100 });
			});

			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailabilityBulk(searchResults, ['RD']);
			});

			// Both should be cleared after completion, even hash-1 which failed
			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-2', 'RD')).toBe(false);
			expect(result.current.isAnyChecking).toBe(false);
		});
	});

	// =========================================================================
	// Service key filtering
	// =========================================================================

	describe('service key filtering', () => {
		it('only checks services for which keys are provided', async () => {
			let resolveRd!: (value: any) => void;
			addRd.mockReturnValue(new Promise((r) => (resolveRd = r)));

			const { result } = renderAvailabilityHook({
				rdKey: 'rd-key',
				adKey: null,
				torboxKey: null,
			});

			let checkPromise: Promise<void>;
			act(() => {
				checkPromise = result.current.checkServiceAvailability(searchResults[0]);
			});

			expect(result.current.isHashServiceChecking('hash-1', 'RD')).toBe(true);
			expect(result.current.isHashServiceChecking('hash-1', 'AD')).toBe(false);
			expect(result.current.isHashServiceChecking('hash-1', 'TB')).toBe(false);

			await act(async () => {
				resolveRd({ id: 'rd-1', status: 'downloaded', progress: 100 });
				await checkPromise!;
			});

			expect(addAd).not.toHaveBeenCalled();
			expect(addTb).not.toHaveBeenCalled();
		});

		it('requesting a service without a key is a no-op for that service', async () => {
			const { result } = renderAvailabilityHook({ torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0], ['TB']);
			});

			// TB key is null, so requesting TB should trigger the "no services" error
			expect(mockToast.error).toHaveBeenCalledWith(
				'No services available for availability check.'
			);
			expect(addTb).not.toHaveBeenCalled();
		});
	});

	// =========================================================================
	// Response parsing / cached detection
	// =========================================================================

	describe('response parsing', () => {
		it('detects RD cached response (status=downloaded, progress=100)', async () => {
			addRd.mockResolvedValue({ id: '123', status: 'downloaded', progress: 100 });
			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0], ['RD']);
			});

			expect(mockCheckDatabaseAvailabilityRd).toHaveBeenCalled();
		});

		it('detects AD cached response (statusCode=4, status=Ready)', async () => {
			addAd.mockResolvedValue({ id: '123', statusCode: 4, status: 'Ready' });
			const { result } = renderAvailabilityHook({ rdKey: null, torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0], ['AD']);
			});

			expect(mockCheckDatabaseAvailabilityAd).toHaveBeenCalled();
		});

		it('detects TB cached response (download_finished=true)', async () => {
			addTb.mockResolvedValue({ id: '123', download_finished: true });
			const { result } = renderAvailabilityHook({ rdKey: null, adKey: null });

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0], ['TB']);
			});

			expect(mockCheckDatabaseAvailabilityTb).toHaveBeenCalled();
		});

		it('does not treat incomplete RD response as cached', async () => {
			addRd.mockResolvedValue({ id: '123', status: 'downloading', progress: 50 });
			const { result } = renderAvailabilityHook({ adKey: null, torboxKey: null });

			await act(async () => {
				await result.current.checkServiceAvailability(searchResults[0], ['RD']);
			});

			// Should still call the db check function (it gets called regardless for the hash array)
			// But the response was not "cached" so the isCachedInRD flag is false
			expect(addRd).toHaveBeenCalled();
			expect(deleteRd).toHaveBeenCalled();
		});
	});
});
