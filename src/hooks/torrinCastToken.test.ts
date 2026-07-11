import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTorrinCastToken } from './torrinCastToken';

vi.mock('@/utils/torrinCastApiClient', () => ({
	saveTorrinCastProfile: vi.fn().mockResolvedValue(undefined),
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

const withCreds =
	(extra: Record<string, [any, any]> = {}) =>
	(key: string) => {
		if (extra[key]) return extra[key];
		if (key === 'torrin:baseUrl') return ['https://tr.test', vi.fn()];
		if (key === 'torrin:apiKey') return ['test-key', vi.fn()];
		if (key === 'torrin:castToken') return [null, vi.fn()];
		return [null, vi.fn()];
	};

describe('useTorrinCastToken', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.mockReturnValue([null, vi.fn()]);
	});

	it('returns null when creds are not set', () => {
		const { result } = renderHook(() => useTorrinCastToken());
		expect(result.current).toBeNull();
	});

	it('handles API errors gracefully', async () => {
		localStorageMock.mockImplementation(withCreds());
		global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

		const { result } = renderHook(() => useTorrinCastToken());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(result.current).toBeNull();
	});

	it('skips fetch when token already exists', async () => {
		localStorageMock.mockImplementation(
			withCreds({ 'torrin:castToken': ['existing-token', vi.fn()] })
		);

		renderHook(() => useTorrinCastToken());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('fetches token with baseUrl + apiKey when none exists', async () => {
		localStorageMock.mockImplementation(withCreds());
		global.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ status: 'success', id: 'tr-token-456' }),
		});

		renderHook(() => useTorrinCastToken());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(global.fetch).toHaveBeenCalledWith(
			`/api/stremio-tr/id?baseUrl=${encodeURIComponent('https://tr.test')}&apiKey=test-key`
		);
	});

	it('does not set token on error response', async () => {
		const setToken = vi.fn();
		localStorageMock.mockImplementation(withCreds({ 'torrin:castToken': [null, setToken] }));
		global.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ status: 'error', message: 'Bad key' }),
		});

		renderHook(() => useTorrinCastToken());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(setToken).not.toHaveBeenCalled();
	});
});
