import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	__resetRealDebridStateForTests,
	useCurrentUser,
	useDebridLinkCredential,
	useDebridLogin,
	useRealDebridAccessToken,
} from './auth';

const routerPush = vi.fn();
vi.mock('next/router', () => ({
	useRouter: () => ({ push: routerPush, asPath: '/library' }),
}));

const {
	mockGetRealDebridUser,
	mockGetToken,
	mockGetAllDebridUser,
	mockGetTorboxUser,
	mockGetPremiumizeAccountInfo,
	mockGetOffcloudAccountInfo,
	mockGetDebridLinkAccountInfo,
	mockRefreshDebridLinkToken,
	mockGetTraktUser,
} = vi.hoisted(() => ({
	mockGetRealDebridUser: vi.fn(),
	mockGetToken: vi.fn(),
	mockGetAllDebridUser: vi.fn(),
	mockGetTorboxUser: vi.fn(),
	mockGetPremiumizeAccountInfo: vi.fn(),
	mockGetOffcloudAccountInfo: vi.fn(),
	mockGetDebridLinkAccountInfo: vi.fn(),
	mockRefreshDebridLinkToken: vi.fn(),
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

vi.mock('../services/offcloud', () => ({
	getOffcloudAccountInfo: mockGetOffcloudAccountInfo,
}));

vi.mock('../services/debridLink', () => ({
	getDebridLinkAccountInfo: mockGetDebridLinkAccountInfo,
	BAD_TOKEN: 'badToken',
}));

vi.mock('../services/debridLinkOAuth', () => ({
	refreshDebridLinkToken: mockRefreshDebridLinkToken,
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
			customer_id: '100000002',
			premium_until: 1789862400,
			limit_used: 0.004,
			space_used: 0,
			booster_points: 0,
		});

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.pmUser).not.toBeNull());
		expect(result.current.hasPMAuth).toBe(true);
		expect(result.current.pmUser?.customer_id).toBe('100000002');
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
			customer_id: '100000002',
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
			customer_id: '100000002',
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

describe('useOffcloud via useCurrentUser', () => {
	const account = {
		user_id: '100000001',
		email: 'me@example.com',
		is_premium: true,
		expiration_date: '2026-10-02',
		can_download: true,
	};

	beforeEach(() => {
		window.localStorage.clear();
		__resetRealDebridStateForTests();
		vi.clearAllMocks();
	});

	it('loads the account once a key is stored', async () => {
		setStoredValue('oc:apiKey', 'oc-key');
		mockGetOffcloudAccountInfo.mockResolvedValue(account);

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.ocUser).not.toBeNull());
		expect(result.current.hasOCAuth).toBe(true);
		expect(result.current.ocUser?.email).toBe('me@example.com');
		expect(mockGetOffcloudAccountInfo).toHaveBeenCalledWith('oc-key');
	});

	it('does not call Offcloud without a key', async () => {
		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.hasOCAuth).toBe(false));
		expect(mockGetOffcloudAccountInfo).not.toHaveBeenCalled();
	});

	// NOAUTH covers a missing, malformed and revoked key alike, so the hook has
	// nothing to distinguish and just has to settle on the error rather than
	// leaving the home page waiting for a profile that will never arrive.
	it('keeps the error rather than the user when the key is refused', async () => {
		setStoredValue('oc:apiKey', 'bad-key');
		mockGetOffcloudAccountInfo.mockRejectedValue(
			Object.assign(new Error('Offcloud account/info failed (401)'), { code: 'NOAUTH' })
		);

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.ocError).not.toBeNull());
		expect(result.current.ocUser).toBeNull();
	});
});

describe('useDebridLink via useCurrentUser', () => {
	const account = {
		username: 'ymsita',
		email: 'p**d@deb*******k',
		emailVerified: true,
		accountType: 1,
		premiumLeft: 3628800,
		pts: 305,
	};

	beforeEach(() => {
		window.localStorage.clear();
		__resetRealDebridStateForTests();
		vi.clearAllMocks();
	});

	it('loads the account from an OAuth access token', async () => {
		setStoredValue('dl:accessToken', 'dl-oauth-token');
		mockGetDebridLinkAccountInfo.mockResolvedValue(account);

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.dlUser).not.toBeNull());
		expect(result.current.hasDLAuth).toBe(true);
		expect(result.current.dlUser?.username).toBe('ymsita');
		expect(mockGetDebridLinkAccountInfo).toHaveBeenCalledWith('dl-oauth-token');
	});

	it('falls back to a pasted API token when there is no OAuth token', async () => {
		setStoredValue('dl:apiKey', 'dl-pasted-token');
		mockGetDebridLinkAccountInfo.mockResolvedValue(account);

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.dlUser).not.toBeNull());
		expect(mockGetDebridLinkAccountInfo).toHaveBeenCalledWith('dl-pasted-token');
	});

	// The OAuth token wins because it is the narrower credential - scoped to
	// what DMM asked for and revocable on its own.
	it('prefers the OAuth token when both credentials exist', () => {
		setStoredValue('dl:accessToken', 'dl-oauth-token');
		setStoredValue('dl:apiKey', 'dl-pasted-token');

		const { result } = renderHook(() => useDebridLinkCredential());

		expect(result.current).toBe('dl-oauth-token');
	});

	it('does not call Debrid-Link without a credential', async () => {
		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.hasDLAuth).toBe(false));
		expect(mockGetDebridLinkAccountInfo).not.toHaveBeenCalled();
	});

	// badToken is returned for an absent, malformed and expired token alike.
	// Leaving the credentials in place would leave a session that fails every
	// call it makes and never routes the user anywhere they can fix it.
	it('drops every dl: credential when the token is refused', async () => {
		setStoredValue('dl:accessToken', 'revoked');
		setStoredValue('dl:refreshToken', 'also-dead');
		setStoredValue('dl:tokenExpiry', Date.now() + 90 * 24 * 60 * 60 * 1000);
		mockGetDebridLinkAccountInfo.mockRejectedValue(
			Object.assign(new Error('The session not exist or expired.'), { code: 'badToken' })
		);

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(window.localStorage.getItem('dl:accessToken')).toBeNull());
		expect(window.localStorage.getItem('dl:refreshToken')).toBeNull();
		expect(window.localStorage.getItem('dl:tokenExpiry')).toBeNull();
		expect(result.current.dlUser).toBeNull();
		expect(result.current.dlError).toBeNull();
	});

	it('keeps a non-auth failure as an error rather than signing the user out', async () => {
		setStoredValue('dl:accessToken', 'dl-oauth-token');
		mockGetDebridLinkAccountInfo.mockRejectedValue(
			Object.assign(new Error('rate-limited for an hour'), { code: 'floodDetected' })
		);

		const { result } = renderHook(() => useCurrentUser());

		await waitFor(() => expect(result.current.dlError).not.toBeNull());
		expect(window.localStorage.getItem('dl:accessToken')).not.toBeNull();
		expect(result.current.dlUser).toBeNull();
	});

	describe('lazy refresh', () => {
		it('renews a token whose stored expiry is close', async () => {
			setStoredValue('dl:accessToken', 'stale');
			setStoredValue('dl:refreshToken', 'rtok');
			setStoredValue('dl:tokenExpiry', Date.now() + 60 * 60 * 1000);
			mockGetDebridLinkAccountInfo.mockResolvedValue(account);
			mockRefreshDebridLinkToken.mockResolvedValue({
				access_token: 'fresh',
				token_type: 'Bearer',
				expires_in: 604800,
			});

			renderHook(() => useCurrentUser());

			await waitFor(() =>
				expect(window.localStorage.getItem('dl:accessToken')).toBe(JSON.stringify('fresh'))
			);
			expect(mockRefreshDebridLinkToken).toHaveBeenCalledWith('rtok');
			// The new absolute expiry, so the next mount does not renew again.
			const expiry = JSON.parse(window.localStorage.getItem('dl:tokenExpiry') as string);
			expect(expiry - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
		});

		// No timers, no scheduler: a token that is nowhere near expiry costs
		// nothing at all.
		it('leaves a token with plenty of life alone', async () => {
			setStoredValue('dl:accessToken', 'good');
			setStoredValue('dl:refreshToken', 'rtok');
			setStoredValue('dl:tokenExpiry', Date.now() + 90 * 24 * 60 * 60 * 1000);
			mockGetDebridLinkAccountInfo.mockResolvedValue(account);

			const { result } = renderHook(() => useCurrentUser());

			await waitFor(() => expect(result.current.dlUser).not.toBeNull());
			expect(mockRefreshDebridLinkToken).not.toHaveBeenCalled();
		});

		it('does nothing when no expiry was ever recorded', async () => {
			setStoredValue('dl:accessToken', 'good');
			setStoredValue('dl:refreshToken', 'rtok');
			mockGetDebridLinkAccountInfo.mockResolvedValue(account);

			const { result } = renderHook(() => useCurrentUser());

			await waitFor(() => expect(result.current.dlUser).not.toBeNull());
			expect(mockRefreshDebridLinkToken).not.toHaveBeenCalled();
		});

		it('does nothing when the sign-in produced no refresh token', async () => {
			setStoredValue('dl:accessToken', 'stale');
			setStoredValue('dl:tokenExpiry', Date.now() + 60 * 60 * 1000);
			mockGetDebridLinkAccountInfo.mockResolvedValue(account);

			const { result } = renderHook(() => useCurrentUser());

			await waitFor(() => expect(result.current.dlUser).not.toBeNull());
			expect(mockRefreshDebridLinkToken).not.toHaveBeenCalled();
		});

		// A failed renewal is not the end of the session: the stored token may
		// still be good, and the profile call is what settles it.
		it('still loads the profile when the renewal fails', async () => {
			setStoredValue('dl:accessToken', 'stale');
			setStoredValue('dl:refreshToken', 'rtok');
			setStoredValue('dl:tokenExpiry', Date.now() + 60 * 60 * 1000);
			mockRefreshDebridLinkToken.mockRejectedValue(new Error('invalid_request'));
			mockGetDebridLinkAccountInfo.mockResolvedValue(account);

			const { result } = renderHook(() => useCurrentUser());

			await waitFor(() => expect(result.current.dlUser).not.toBeNull());
			expect(window.localStorage.getItem('dl:accessToken')).toBe(JSON.stringify('stale'));
		});
	});
});

describe('useDebridLogin', () => {
	it('sends Offcloud sign-in to its own login page, carrying the return path', () => {
		routerPush.mockClear();

		const { result } = renderHook(() => useDebridLogin());
		result.current.loginWithOffcloud();

		expect(routerPush).toHaveBeenCalledWith({
			pathname: '/offcloud/login',
			query: { redirect: '/library' },
		});
	});

	it('sends Debrid-Link sign-in to its own login page, carrying the return path', () => {
		routerPush.mockClear();

		const { result } = renderHook(() => useDebridLogin());
		result.current.loginWithDebridLink();

		expect(routerPush).toHaveBeenCalledWith({
			pathname: '/debridlink/login',
			query: { redirect: '/library' },
		});
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
