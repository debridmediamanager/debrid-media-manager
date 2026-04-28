import { act, renderHook } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosPostMock } = vi.hoisted(() => ({
	axiosPostMock: vi.fn(),
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
});
