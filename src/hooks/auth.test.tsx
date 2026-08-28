import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRealDebridStateForTests, useCurrentUser, useRealDebridAccessToken } from './auth';

const {
	mockGetRealDebridUser,
	mockGetToken,
	mockGetAllDebridUser,
	mockGetTorboxUser,
	mockGetPremiumizeAccountInfo,
	mockGetTraktUser,
} = vi.hoisted(() => ({
	mockGetRealDebridUser: vi.fn(),
	mockGetToken: vi.fn(),
	mockGetAllDebridUser: vi.fn(),
	mockGetTorboxUser: vi.fn(),
	mockGetPremiumizeAccountInfo: vi.fn(),
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

vi.mock('../services/premiumize', () => ({
	getPremiumizeAccountInfo: mockGetPremiumizeAccountInfo,
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

	it('validates a pasted API key that has no OAuth credentials behind it', async () => {
		// The API-key login writes only this one key. Before, the missing OAuth
		// credentials read as a logout: the token worked everywhere that reads it
		// directly, while the profile stayed empty.
		setStoredValue('rd:accessToken', 'pasted-key');
		mockGetRealDebridUser.mockResolvedValue({ username: 'rd-user' });

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.rdUser?.username).toBe('rd-user'));
		expect(result.current.hasRDAuth).toBe(true);
		expect(mockGetToken).not.toHaveBeenCalled();
	});

	it('drops a pasted API key Real-Debrid rejects', async () => {
		setStoredValue('rd:accessToken', 'revoked-key');
		mockGetRealDebridUser.mockRejectedValue(
			Object.assign(new Error('bad token'), { response: { status: 401 } })
		);

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(window.localStorage.getItem('rd:accessToken')).toBeNull());
		expect(result.current.rdUser).toBeNull();
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

	it('renews the access token before it expires instead of letting it lapse', async () => {
		vi.useFakeTimers();
		// a token minted an hour ago with a 1h life: already past the renewal point
		window.localStorage.setItem(
			'rd:accessToken',
			JSON.stringify({ value: 'aging', expiry: Date.now() + 6 * 60 * 1000 })
		);
		setStoredValue('rd:refreshToken', 'refresh');
		setStoredValue('rd:clientId', 'client');
		setStoredValue('rd:clientSecret', 'secret');
		mockGetRealDebridUser.mockResolvedValue({ username: 'rd-user' });
		mockGetToken.mockResolvedValue({ access_token: 'renewed', expires_in: 3600 });

		renderHook(() => useRealDebridAccessToken());
		await vi.advanceTimersByTimeAsync(0);

		// the existing token still works, so no renewal yet
		expect(mockGetToken).not.toHaveBeenCalled();

		// ...until the scheduler reaches the safety margin
		await vi.advanceTimersByTimeAsync(90 * 1000);

		expect(mockGetToken).toHaveBeenCalledTimes(1);
		const stored = JSON.parse(window.localStorage.getItem('rd:accessToken') as string);
		expect(stored.value).toBe('renewed');
	});

	it('does not spin when the token lifetime is shorter than the refresh margin', async () => {
		vi.useFakeTimers();
		setStoredValue('rd:refreshToken', 'refresh');
		setStoredValue('rd:clientId', 'client');
		setStoredValue('rd:clientSecret', 'secret');
		mockGetRealDebridUser.mockResolvedValue({ username: 'rd-user' });
		// 60s lifetime is well inside the 5 minute margin
		mockGetToken.mockResolvedValue({ access_token: 'short', expires_in: 60 });

		renderHook(() => useRealDebridAccessToken());
		await vi.advanceTimersByTimeAsync(0);
		const afterInitial = mockGetToken.mock.calls.length;

		// a naive "expiry - margin" delay lands on 0 here and renews in a hot loop
		await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

		expect(mockGetToken.mock.calls.length - afterInitial).toBeLessThanOrEqual(4);
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

describe('usePremiumize via useCurrentUser', () => {
	beforeEach(() => {
		window.localStorage.clear();
		__resetRealDebridStateForTests();
		vi.clearAllMocks();
	});

	it('loads the account once a key is stored', async () => {
		setStoredValue('pm:apiKey', 'pm-key');
		mockGetPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '704233992',
			premium_until: 1789862400,
			limit_used: 0.004,
			space_used: 0,
			booster_points: 0,
		});

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.pmUser).not.toBeNull());
		expect(result.current.hasPMAuth).toBe(true);
		expect(result.current.pmUser?.customer_id).toBe('704233992');
		expect(mockGetPremiumizeAccountInfo).toHaveBeenCalledWith('pm-key');
	});

	it('does not call Premiumize without a key', async () => {
		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.hasPMAuth).toBe(false));
		expect(mockGetPremiumizeAccountInfo).not.toHaveBeenCalled();
	});

	it('keeps the error rather than the user when the key is refused', async () => {
		setStoredValue('pm:apiKey', 'bad-key');
		mockGetPremiumizeAccountInfo.mockRejectedValue(new Error('Not logged in.'));

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.pmError).not.toBeNull());
		expect(result.current.pmUser).toBeNull();
	});

	it('prefers the OAuth token over a pasted key - it is the narrower credential', async () => {
		// Only the API key opens WebDAV and Usenet; the OAuth token does not.
		setStoredValue('pm:apiKey', 'pasted-key');
		setStoredValue('pm:accessToken', 'oauth-token');
		mockGetPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '704233992',
			premium_until: 1789862400,
			limit_used: 0,
			space_used: 0,
			booster_points: 0,
		});

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.pmUser).not.toBeNull());
		expect(mockGetPremiumizeAccountInfo).toHaveBeenCalledWith('oauth-token');
	});

	it('falls back to the pasted key when there is no token', async () => {
		setStoredValue('pm:apiKey', 'pasted-key');
		mockGetPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '704233992',
			premium_until: 1789862400,
			limit_used: 0,
			space_used: 0,
			booster_points: 0,
		});

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.pmUser).not.toBeNull());
		expect(mockGetPremiumizeAccountInfo).toHaveBeenCalledWith('pasted-key');
	});
});

describe('useTorBox via useCurrentUser', () => {
	// TorBox answers a rejected key with HTTP 200 and success:false, so nothing
	// throws. The hook used to set neither user nor error, leaving a terminal
	// state the home page could not tell apart from "still loading" - which is
	// what left it on "Debrid Media Manager is loading..." indefinitely.
	it('reports a TorBox success:false answer as an error', async () => {
		setStoredValue('tb:apiKey', 'tb-key');
		mockGetTorboxUser.mockResolvedValue({
			success: false,
			detail: 'Invalid API key.',
			data: null,
		});

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.tbError).toBeInstanceOf(Error));
		expect(result.current.tbError?.message).toBe('Invalid API key.');
		expect(result.current.tbUser).toBeNull();
	});

	it('keeps a successful TorBox answer free of errors', async () => {
		setStoredValue('tb:apiKey', 'tb-key');
		mockGetTorboxUser.mockResolvedValue({ success: true, data: { id: 1 } });

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.tbUser).toEqual({ id: 1 }));
		expect(result.current.tbError).toBeNull();
	});
});
