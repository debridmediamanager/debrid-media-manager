import { act, renderHook } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosPostMock } = vi.hoisted(() => ({
	axiosPostMock: vi.fn(),
}));

const { generateTokenAndHashMock } = vi.hoisted(() => ({
	generateTokenAndHashMock: vi.fn(),
}));

const { toastMocks } = vi.hoisted(() => ({
	toastMocks: {
		error: vi.fn(),
		success: vi.fn(),
		loading: vi.fn().mockReturnValue('toast-id'),
	},
}));

vi.mock('axios', () => ({
	__esModule: true,
	default: {
		post: (...args: any[]) => axiosPostMock(...args),
	},
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMocks,
}));

// The hook paces its batches to stay inside the endpoint's 5-per-10s IP limit.
// The pacing itself is not what these tests are checking, and waiting it out
// would push the batching test past Vitest's timeout.
vi.mock('@/utils/delay', () => ({
	__esModule: true,
	delay: vi.fn(async () => {}),
}));

vi.mock('@/utils/token', () => ({
	generateTokenAndHash: () => generateTokenAndHashMock(),
}));

import { useMassReport } from './useMassReport';

const reloadMock = vi.fn();

describe('useMassReport', () => {
	beforeAll(() => {
		Object.defineProperty(window, 'location', {
			value: { reload: reloadMock },
			configurable: true,
		});
	});

	beforeEach(() => {
		vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
		axiosPostMock.mockReset();
		toastMocks.error.mockReset();
		toastMocks.success.mockReset();
		toastMocks.loading.mockReset().mockReturnValue('toast-id');
		reloadMock.mockReset();
		generateTokenAndHashMock.mockReset().mockResolvedValue(['token', 'hash']);
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	it('asks the user to sign in before reporting when no keys are present', async () => {
		const { result } = renderHook(() => useMassReport(null, null, null, 'tt1234'));
		await act(async () => {
			await result.current.handleMassReport('porn', [{ hash: 'abc' } as any]);
		});

		expect(toastMocks.error).toHaveBeenCalledWith(
			'Sign in to a debrid service before reporting.'
		);
		expect(axiosPostMock).not.toHaveBeenCalled();
	});

	it('requires torrents to be selected before reporting', async () => {
		const { result } = renderHook(() => useMassReport('rd', null, null, 'tt1234'));
		await act(async () => {
			await result.current.handleMassReport('porn', []);
		});

		expect(toastMocks.error).toHaveBeenCalledWith('Select torrents before reporting.');
	});

	it('submits mass reports and refreshes the page on success', async () => {
		vi.useFakeTimers();
		const { result } = renderHook(() => useMassReport('rd', null, null, 'tt1234'));
		axiosPostMock.mockResolvedValue({
			data: { success: true, reported: 2, failed: 1 },
		});

		await act(async () => {
			await result.current.handleMassReport('wrong_imdb', [
				{ hash: 'abc' } as any,
				{ hash: 'def' } as any,
			]);
		});

		expect(axiosPostMock).toHaveBeenCalledWith('/api/report/mass', {
			reports: [
				{ hash: 'abc', imdbId: 'tt1234' },
				{ hash: 'def', imdbId: 'tt1234' },
			],
			userId: 'rd',
			type: 'wrong_imdb',
			dmmProblemKey: 'token',
			solution: 'hash',
		});
		expect(toastMocks.success).toHaveBeenCalledWith('Reported 2 torrents.', {
			id: 'toast-id',
		});
		expect(toastMocks.error).toHaveBeenCalledWith('Failed to report 1 torrents.');

		vi.runAllTimers();
		expect(reloadMock).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('shows an error toast when the API request fails', async () => {
		vi.useFakeTimers();
		const { result } = renderHook(() => useMassReport(null, 'ad', null, 'tt9999'));
		axiosPostMock.mockRejectedValue(new Error('boom'));

		await act(async () => {
			await result.current.handleMassReport('porn', [{ hash: 'zzz' } as any]);
		});

		expect(toastMocks.error).toHaveBeenLastCalledWith('Failed to submit reports.', {
			id: 'toast-id',
		});
		vi.runAllTimers();
		expect(reloadMock).toHaveBeenCalled();
		vi.useRealTimers();
	});

	// The endpoint caps a request at 100 rows, and a filtered result set routinely
	// runs longer than that — so the tail must be batched, not dropped.
	it('splits a selection larger than the per-request cap into batches', async () => {
		vi.useFakeTimers();
		const { result } = renderHook(() => useMassReport('rd', null, null, 'tt1234'));
		axiosPostMock.mockResolvedValue({ data: { success: true, reported: 100, failed: 0 } });

		const selection = Array.from({ length: 250 }, (_, i) => ({ hash: `h${i}` }) as any);

		await act(async () => {
			await result.current.handleMassReport('porn', selection);
		});

		expect(axiosPostMock).toHaveBeenCalledTimes(3);
		expect(axiosPostMock.mock.calls[0][1].reports).toHaveLength(100);
		expect(axiosPostMock.mock.calls[2][1].reports).toHaveLength(50);
		// One mint reused across the batches rather than one per batch.
		expect(generateTokenAndHashMock).toHaveBeenCalledTimes(1);
		expect(toastMocks.success).toHaveBeenCalledWith('Reported 300 torrents.', {
			id: 'toast-id',
		});

		vi.runAllTimers();
		vi.useRealTimers();
	});

	it('tells the user when the token could not be minted', async () => {
		vi.useFakeTimers();
		const { result } = renderHook(() => useMassReport('rd', null, null, 'tt1234'));
		generateTokenAndHashMock.mockRejectedValue(new Error('challenge down'));

		await act(async () => {
			await result.current.handleMassReport('porn', [{ hash: 'abc' } as any]);
		});

		expect(axiosPostMock).not.toHaveBeenCalled();
		expect(toastMocks.error).toHaveBeenLastCalledWith('Failed to submit reports.', {
			id: 'toast-id',
		});
		vi.runAllTimers();
		vi.useRealTimers();
	});

	// A batch failing mid-run used to unwind the whole loop and tell the user
	// "Failed to submit reports." — even though every earlier batch had already
	// been written. The count that actually landed has to survive into the message.
	it('reports how much landed when a later batch fails', async () => {
		const selection = Array.from({ length: 250 }, (_, i) => ({ hash: `h${i}` }) as any);
		axiosPostMock
			.mockResolvedValueOnce({ data: { success: true, reported: 100, failed: 0 } })
			.mockResolvedValueOnce({ data: { success: true, reported: 100, failed: 0 } })
			.mockRejectedValueOnce(
				Object.assign(new Error('rate limited'), {
					response: { status: 429 },
				})
			);

		const { result } = renderHook(() => useMassReport('rd-key', null, null, 'tt1234567'));

		await act(async () => {
			await result.current.handleMassReport('porn', selection);
		});

		expect(axiosPostMock).toHaveBeenCalledTimes(3);
		expect(toastMocks.error).toHaveBeenCalledWith(
			'Reported 200 of 250 torrents. Please retry the rest.',
			{ id: 'toast-id' }
		);
		expect(toastMocks.error).not.toHaveBeenCalledWith('Failed to submit reports.', {
			id: 'toast-id',
		});
	});
});
