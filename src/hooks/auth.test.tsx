import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRealDebridStateForTests, useCurrentUser, useRealDebridAccessToken } from './auth';

const {
	mockGetRealDebridUser,
	mockGetToken,
	mockGetAllDebridUser,
	mockGetTorboxUser,
	mockGetTraktUser,
} = vi.hoisted(() => ({
	mockGetRealDebridUser: vi.fn(),
	mockGetToken: vi.fn(),
	mockGetAllDebridUser: vi.fn(),
	mockGetTorboxUser: vi.fn(),
	mockGetTraktUser: vi.fn(),
}));

vi.mock('../services/realDebrid', () => ({
	getCurrentUser: mockGetRealDebridUser,
	getToken: mockGetToken,
}));

vi.mock('../services/allDebrid', () => ({
	getAllDebridUser: mockGetAllDebridUser,
}));

vi.mock('../services/torbox', () => ({
	getUserData: mockGetTorboxUser,
}));

vi.mock('../services/trakt', () => ({
	getTraktUser: mockGetTraktUser,
}));

const setStoredValue = (key: string, value: unknown) => {
	window.localStorage.setItem(key, JSON.stringify(value));
};

describe('auth hooks', () => {
	beforeEach(() => {
		window.localStorage.clear();
		__resetRealDebridStateForTests();
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('returns existing RD token once the user is validated', async () => {
		setStoredValue('rd:accessToken', 'rd-token');
		setStoredValue('rd:refreshToken', 'refresh');
		setStoredValue('rd:clientId', 'client');
		setStoredValue('rd:clientSecret', 'secret');
		mockGetRealDebridUser.mockResolvedValue({ username: 'rd-user' });

		const { result } = renderHook(() => useRealDebridAccessToken());

		await waitFor(() => expect(result.current[1]).toBe(false));
		expect(result.current[0]).toBe('rd-token');
		expect(mockGetRealDebridUser).toHaveBeenCalledWith('rd-token');
	});

	it('refreshes RD token when the stored one is invalid', async () => {
		setStoredValue('rd:accessToken', 'stale');
		setStoredValue('rd:refreshToken', 'refresh');
		setStoredValue('rd:clientId', 'client');
		setStoredValue('rd:clientSecret', 'secret');
		mockGetRealDebridUser
			.mockRejectedValueOnce(new Error('expired'))
			.mockResolvedValueOnce({ username: 'rd-user' });
		mockGetToken.mockResolvedValue({ access_token: 'new-token', expires_in: 60 });

		const { result } = renderHook(() => useRealDebridAccessToken());

		await waitFor(() => expect(result.current[1]).toBe(false));
		expect(mockGetToken).toHaveBeenCalledWith('client', 'secret', 'refresh');
		expect(mockGetRealDebridUser).toHaveBeenLastCalledWith('new-token');
	});

	it('combines providers in useCurrentUser', async () => {
		setStoredValue('rd:accessToken', 'rd-token');
		setStoredValue('rd:refreshToken', 'refresh');
		setStoredValue('rd:clientId', 'client');
		setStoredValue('rd:clientSecret', 'secret');
		setStoredValue('ad:apiKey', 'ad-key');
		setStoredValue('tb:apiKey', 'tb-key');
		setStoredValue('trakt:accessToken', 'trakt-token');

		mockGetRealDebridUser.mockResolvedValue({ username: 'rd-user' });
		mockGetAllDebridUser.mockResolvedValue({ username: 'ad-user' });
		mockGetTorboxUser.mockResolvedValue({ success: true, data: { email: 'tb@example.com' } });
		mockGetTraktUser.mockResolvedValue({ user: { ids: { slug: 'sluggy' } } });

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.rdUser?.username).toBe('rd-user'));
		expect(result.current.hasRDAuth).toBe(true);
		expect(result.current.adUser?.username).toBe('ad-user');
		expect(result.current.tbUser?.email).toBe('tb@example.com');
		expect(result.current.hasTraktAuth).toBe(true);
		expect(window.localStorage.getItem('trakt:userSlug')).toContain('sluggy');
	});

	it('does not clear credentials on transient errors and retries with backoff', async () => {
		vi.useFakeTimers();
		setStoredValue('rd:accessToken', 'stale');
		setStoredValue('rd:refreshToken', 'refresh');
		setStoredValue('rd:clientId', 'client');
		setStoredValue('rd:clientSecret', 'secret');
		// Reject stale token consistently, accept new token
		mockGetRealDebridUser
			.mockRejectedValueOnce(new Error('expired')) // attempt 0: token check
			.mockRejectedValueOnce(new Error('expired')) // attempt 1: token check
			.mockResolvedValueOnce({ username: 'rd-user' }); // attempt 1: after refresh
		// Fail first, then succeed on retry
		mockGetToken
			.mockRejectedValueOnce(new Error('Network Error'))
			.mockResolvedValueOnce({ access_token: 'new-token', expires_in: 60 });

		renderHook(() => useRealDebridAccessToken());

		// Let initial async operations complete
		await vi.advanceTimersByTimeAsync(0);

		// Credentials should NOT be cleared on transient errors
		expect(window.localStorage.getItem('rd:refreshToken')).not.toBeNull();
		expect(mockGetToken).toHaveBeenCalledTimes(1);

		// Advance past first retry delay (1s) and let retry async ops complete
		await vi.advanceTimersByTimeAsync(1100);

		expect(mockGetToken).toHaveBeenCalledTimes(2);
	});

	it('clears credentials on 401 auth error during token refresh', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		setStoredValue('rd:accessToken', 'stale');
		setStoredValue('rd:refreshToken', 'refresh');
		setStoredValue('rd:clientId', 'client');
		setStoredValue('rd:clientSecret', 'secret');
		mockGetRealDebridUser.mockRejectedValueOnce(new Error('expired'));
		// Simulate a 401 response (invalid refresh token)
		const authError = new Error('Unauthorized');
		(authError as any).response = { status: 401 };
		mockGetToken.mockRejectedValue(authError);

		const { result } = renderHook(() => useRealDebridAccessToken());

		await waitFor(() => expect(result.current[1]).toBe(false));
		// Verify catch block was reached
		expect(errorSpy).toHaveBeenCalledWith('RealDebrid auth error:', authError);
		// clearRdKeys removes all rd: keys on auth errors
		expect(window.localStorage.getItem('rd:refreshToken')).toBeNull();
		errorSpy.mockRestore();
	});

	it('authenticates after login when page remounts with new tokens', async () => {
		mockGetRealDebridUser.mockResolvedValue({ username: 'rd-user' });

		const { result: result1, unmount } = renderHook(() => useRealDebridAccessToken());

		await waitFor(() => expect(result1.current[1]).toBe(false));
		expect(result1.current[0]).toBeNull();
		expect(mockGetRealDebridUser).not.toHaveBeenCalled();

		unmount();
		__resetRealDebridStateForTests();

		setStoredValue('rd:accessToken', 'new-token');
		setStoredValue('rd:refreshToken', 'refresh');
		setStoredValue('rd:clientId', 'client');
		setStoredValue('rd:clientSecret', 'secret');

		const { result: result2 } = renderHook(() => useRealDebridAccessToken());

		await waitFor(() => expect(result2.current[1]).toBe(false));
		expect(result2.current[0]).toBe('new-token');
		expect(mockGetRealDebridUser).toHaveBeenCalledWith('new-token');
	});
});
