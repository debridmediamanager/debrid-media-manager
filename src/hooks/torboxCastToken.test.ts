import { saveTorBoxCastProfile } from '@/utils/torboxCastApiClient';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTorBoxCastToken } from './torboxCastToken';

vi.mock('@/utils/torboxCastApiClient', () => ({
	saveTorBoxCastProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/browserStorage', () => ({
	getLocalStorageItemOrDefault: vi.fn().mockReturnValue('100'),
	getLocalStorageBoolean: vi.fn().mockReturnValue(false),
}));

vi.mock('@/utils/settings', () => ({
	defaultMovieSize: 2000,
	defaultEpisodeSize: 1000,
	defaultOtherStreamsLimit: 5,
}));

vi.mock('react-hot-toast', () => ({
	default: {
		error: vi.fn(),
	},
}));

const localStorageMock = vi.fn().mockReturnValue([null, vi.fn()]);
vi.mock('./localStorage', () => ({
	default: (...args: any[]) => localStorageMock(...args),
}));

global.fetch = vi.fn();

describe('useTorBoxCastToken', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.mockReturnValue([null, vi.fn()]);
	});

	it('returns null when no API key is set', () => {
		const { result } = renderHook(() => useTorBoxCastToken());
		expect(result.current).toBeNull();
	});

	it('handles API errors gracefully', async () => {
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return ['test-api-key', vi.fn()];
			if (key === 'tb:castToken') return [null, vi.fn()];
			return [null, vi.fn()];
		});

		global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

		const { result } = renderHook(() => useTorBoxCastToken());

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(result.current).toBeNull();
	});

	it('skips fetch when token already exists', async () => {
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return ['test-key', vi.fn()];
			if (key === 'tb:castToken') return ['existing-token', vi.fn()];
			return [null, vi.fn()];
		});

		renderHook(() => useTorBoxCastToken());

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(global.fetch).not.toHaveBeenCalled();
	});

	// Regression: settings saved before the API key decoding fix never reached the
	// server, and the profile was only pushed when a token was missing, so those
	// users stayed on the default otherStreamsLimit forever.
	it('resyncs the profile even when a token already exists', async () => {
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return ['test-key', vi.fn()];
			if (key === 'tb:castToken') return ['existing-token', vi.fn()];
			return [null, vi.fn()];
		});

		renderHook(() => useTorBoxCastToken());

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(saveTorBoxCastProfile).toHaveBeenCalledWith('test-key', 100, 100, 100, false);
	});

	it('saves the profile only once across effect re-runs', async () => {
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return ['test-key', vi.fn()];
			if (key === 'tb:castToken') return ['existing-token', vi.fn()];
			return [null, vi.fn()];
		});

		const { rerender } = renderHook(() => useTorBoxCastToken());

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		rerender();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(saveTorBoxCastProfile).toHaveBeenCalledTimes(1);
	});

	it('fetches token when API key exists but no token', async () => {
		const setToken = vi.fn();
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return ['test-key', vi.fn()];
			if (key === 'tb:castToken') return [null, setToken];
			return [null, vi.fn()];
		});

		global.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ status: 'success', id: 'tb-token-456' }),
		});

		renderHook(() => useTorBoxCastToken());

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(global.fetch).toHaveBeenCalledWith('/api/stremio-tb/id?apiKey=test-key');
	});

	it('does not set token on error response', async () => {
		const setToken = vi.fn();
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'tb:apiKey') return ['test-key', vi.fn()];
			if (key === 'tb:castToken') return [null, setToken];
			return [null, vi.fn()];
		});

		global.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ status: 'error', message: 'Bad key' }),
		});

		renderHook(() => useTorBoxCastToken());

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(setToken).not.toHaveBeenCalled();
	});
});
