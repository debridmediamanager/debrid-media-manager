import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAllDebridCastToken } from './allDebridCastToken';

vi.mock('@/utils/allDebridCastApiClient', () => ({
	saveAllDebridCastProfile: vi.fn().mockResolvedValue(undefined),
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

describe('useAllDebridCastToken', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.mockReturnValue([null, vi.fn()]);
	});

	it('returns null when no API key is set', () => {
		const { result } = renderHook(() => useAllDebridCastToken());
		expect(result.current).toBeNull();
	});

	it('handles API errors gracefully', async () => {
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'ad:apiKey') return ['test-api-key', vi.fn()];
			if (key === 'ad:castToken') return [null, vi.fn()];
			return [null, vi.fn()];
		});

		global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

		const { result } = renderHook(() => useAllDebridCastToken());

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(result.current).toBeNull();
	});

	it('returns existing token if already set', () => {
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'ad:apiKey') return ['test-key', vi.fn()];
			if (key === 'ad:castToken') return ['existing-token', vi.fn()];
			return [null, vi.fn()];
		});

		const { result } = renderHook(() => useAllDebridCastToken());
		expect(result.current).toBe('existing-token');
	});

	it('fetches token when API key exists but no token', async () => {
		const setToken = vi.fn();
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'ad:apiKey') return ['test-key', vi.fn()];
			if (key === 'ad:castToken') return [null, setToken];
			return [null, vi.fn()];
		});

		global.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ status: 'success', id: 'token-123' }),
		});

		renderHook(() => useAllDebridCastToken());

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(global.fetch).toHaveBeenCalledWith('/api/stremio-ad/id?apiKey=test-key');
	});

	it('does not set token on error response', async () => {
		const setToken = vi.fn();
		localStorageMock.mockImplementation((key: string) => {
			if (key === 'ad:apiKey') return ['test-key', vi.fn()];
			if (key === 'ad:castToken') return [null, setToken];
			return [null, vi.fn()];
		});

		global.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ status: 'error', message: 'Invalid key' }),
		});

		renderHook(() => useAllDebridCastToken());

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(setToken).not.toHaveBeenCalled();
	});
});
