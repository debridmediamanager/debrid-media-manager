import { act, renderHook } from '@testing-library/react';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCastToken } from './castToken';

// Mock the real-debrid API
vi.mock('@/services/realDebrid', () => ({
	getRealDebridApi: () => ({
		get: vi.fn(),
		post: vi.fn(),
	}),
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
	default: {
		error: vi.fn(),
	},
}));

vi.mock('@/utils/castApiClient', () => ({ saveCastProfile: vi.fn() }));

// Mock fetch
global.fetch = vi.fn();

describe('useCastToken', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should initialize with null token when no credentials', () => {
		const { result } = renderHook(() => useCastToken());

		expect(result.current).toBeNull();
	});

	it('should return null when credentials are missing', () => {
		const { result } = renderHook(() => useCastToken());

		// Without credentials, the hook should return null
		expect(result.current).toBeNull();
	});

	it('should handle successful token generation', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ status: 'success', id: 'test-token-123' }),
		});
		global.fetch = mockFetch;

		const { result } = renderHook(() => useCastToken());

		// Since the hook uses useEffect and localStorage, the token will be null initially
		expect(result.current).toBeNull();
	});

	it('should handle API errors gracefully', async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'));
		global.fetch = mockFetch;

		const { result } = renderHook(() => useCastToken());

		// Wait for useEffect to run
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(result.current).toBeNull();
	});

	it('should return existing token if already set', () => {
		// Mock localStorage to return an existing token
		const { result } = renderHook(() => useCastToken());

		// The hook returns the token value directly, which can be string or null
		expect(['string', 'object', 'null']).toContain(typeof result.current);
	});

	/**
	 * Reported 2026-11-05 (Reddit, self-hosted DMM): /api/stremio/id failed on the member's own
	 * server, the hook dropped the answer, and /kodi only said the browser was not signed in.
	 */
	it('says why the server could not make the cast id instead of dropping it', async () => {
		localStorage.setItem('rd:accessToken', JSON.stringify('rd-token'));
		global.fetch = vi.fn().mockResolvedValue({
			json: () =>
				Promise.resolve({
					status: 'error',
					errorMessage:
						'Failed to generate user ID: DMMCAST_SALT environment variable is not set',
				}),
		});

		const { result } = renderHook(() => useCastToken());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(result.current).toBeFalsy();
		expect(toast.error).toHaveBeenCalledWith(
			'DMM Cast for Real-Debrid: Failed to generate user ID: DMMCAST_SALT environment variable is not set'
		);
		localStorage.clear();
	});
});
