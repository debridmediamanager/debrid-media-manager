import DebridLinkLoginPage from '@/pages/debridlink/login';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/router', () => ({ useRouter: vi.fn() }));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const setStored: Record<string, ReturnType<typeof vi.fn>> = {
	'dl:apiKey': vi.fn(),
	'dl:accessToken': vi.fn(),
	'dl:refreshToken': vi.fn(),
	'dl:tokenExpiry': vi.fn(),
};
vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: (key: string) => [null, setStored[key] ?? vi.fn()],
}));

const requestDebridLinkDeviceCode = vi.fn();
const pollDebridLinkDeviceToken = vi.fn();
vi.mock('@/services/debridLinkOAuth', async () => {
	const actual = await vi.importActual<typeof import('@/services/debridLinkOAuth')>(
		'@/services/debridLinkOAuth'
	);
	return {
		...actual,
		requestDebridLinkDeviceCode: () => requestDebridLinkDeviceCode(),
		pollDebridLinkDeviceToken: (...a: unknown[]) => pollDebridLinkDeviceToken(...a),
	};
});

const getDebridLinkAccountInfo = vi.fn();
vi.mock('@/services/debridLink', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/debridLink')>('@/services/debridLink');
	return {
		...actual,
		getDebridLinkAccountInfo: (...args: unknown[]) => getDebridLinkAccountInfo(...args),
	};
});

const replace = vi.fn();

const premiumAccount = {
	username: 'ymsita',
	email: 'p**d@deb*******k',
	emailVerified: true,
	accountType: 1,
	premiumLeft: 3628800,
	pts: 305,
};

const submit = (key = 'dl-test-token') => {
	fireEvent.change(screen.getByLabelText('API Token'), { target: { value: key } });
	fireEvent.click(screen.getByRole('button', { name: 'Save API Token' }));
};

const setApiKey = setStored['dl:apiKey'];
const setAccessToken = setStored['dl:accessToken'];
const setRefreshToken = setStored['dl:refreshToken'];
const setTokenExpiry = setStored['dl:tokenExpiry'];

beforeEach(() => {
	setApiKey.mockReset();
	setAccessToken.mockReset();
	setRefreshToken.mockReset();
	setTokenExpiry.mockReset();
	requestDebridLinkDeviceCode.mockReset();
	pollDebridLinkDeviceToken.mockReset();
	getDebridLinkAccountInfo.mockReset();
	replace.mockReset();
	vi.mocked(useRouter).mockReturnValue({ replace, query: {} } as any);
});

describe('DebridLinkLoginPage', () => {
	describe('pasted API token', () => {
		it('stores the token under dl:apiKey and redirects once Debrid-Link accepts it', async () => {
			getDebridLinkAccountInfo.mockResolvedValue(premiumAccount);

			render(<DebridLinkLoginPage />);
			submit();

			await waitFor(() => expect(setApiKey).toHaveBeenCalledWith('dl-test-token'));
			// The pasted token is the whole account; it must never be filed as
			// the scoped OAuth credential.
			expect(setAccessToken).not.toHaveBeenCalledWith('dl-test-token');
			expect(replace).toHaveBeenCalledWith('/');
		});

		// `useDebridLinkCredential` prefers `dl:accessToken` over `dl:apiKey`,
		// so a token saved beside a stale OAuth credential is never the one
		// sent. Someone whose OAuth access died and who fixes it by pasting a
		// fresh API token would stay broken with no feedback: the login says it
		// worked and every page keeps failing. The refresh pair goes with it -
		// left behind, it mints a replacement access token that wins again.
		it('drops a superseded OAuth credential so the new token is the one in use', async () => {
			getDebridLinkAccountInfo.mockResolvedValue(premiumAccount);

			render(<DebridLinkLoginPage />);
			submit();

			await waitFor(() => expect(setApiKey).toHaveBeenCalledWith('dl-test-token'));
			expect(setAccessToken).toHaveBeenCalledWith(null);
			expect(setRefreshToken).toHaveBeenCalledWith(null);
			expect(setTokenExpiry).toHaveBeenCalledWith(null);
		});

		it('leaves the OAuth credential alone when the token is rejected', async () => {
			getDebridLinkAccountInfo.mockRejectedValue(
				Object.assign(new Error('bad'), { code: 'badToken' })
			);

			render(<DebridLinkLoginPage />);
			submit();

			await waitFor(() =>
				expect(screen.getByText(/rejected that token/i)).toBeInTheDocument()
			);
			expect(setAccessToken).not.toHaveBeenCalled();
			expect(setRefreshToken).not.toHaveBeenCalled();
			expect(setApiKey).not.toHaveBeenCalled();
		});

		it('returns the user to where they came from', async () => {
			vi.mocked(useRouter).mockReturnValue({
				replace,
				query: { redirect: '/library' },
			} as any);
			getDebridLinkAccountInfo.mockResolvedValue(premiumAccount);

			render(<DebridLinkLoginPage />);
			submit();

			await waitFor(() => expect(replace).toHaveBeenCalledWith('/library'));
		});

		it('trims the pasted token - Debrid-Link compares it exactly', async () => {
			getDebridLinkAccountInfo.mockResolvedValue(premiumAccount);

			render(<DebridLinkLoginPage />);
			submit('  dl-test-token  ');

			await waitFor(() =>
				expect(getDebridLinkAccountInfo).toHaveBeenCalledWith('dl-test-token')
			);
			expect(setApiKey).toHaveBeenCalledWith('dl-test-token');
		});

		// accountType 0 is a free account, and the seedbox is premium-only -
		// every add would be refused after a sign-in that looked fine.
		it('refuses a free account', async () => {
			getDebridLinkAccountInfo.mockResolvedValue({ ...premiumAccount, accountType: 0 });

			render(<DebridLinkLoginPage />);
			submit();

			await waitFor(() => expect(screen.getByText(/not premium/i)).toBeInTheDocument());
			expect(setApiKey).not.toHaveBeenCalled();
			expect(replace).not.toHaveBeenCalled();
		});

		// badToken covers an absent, malformed and revoked token alike, so the
		// page must not claim to know which one it was.
		it('reports a rejected token without guessing why', async () => {
			getDebridLinkAccountInfo.mockRejectedValue(
				Object.assign(new Error('The session not exist or expired.'), { code: 'badToken' })
			);

			render(<DebridLinkLoginPage />);
			submit('nope');

			await waitFor(() =>
				expect(screen.getByText('Debrid-Link rejected that token.')).toBeInTheDocument()
			);
			expect(setApiKey).not.toHaveBeenCalled();
		});

		it('surfaces a transport failure distinctly from a bad token', async () => {
			getDebridLinkAccountInfo.mockRejectedValue(
				Object.assign(new Error('Debrid-Link answered 200 with text/html'), {
					code: 'non_json_response',
				})
			);

			render(<DebridLinkLoginPage />);
			submit();

			await waitFor(() => expect(screen.getByText(/text\/html/)).toBeInTheDocument());
			expect(screen.queryByText('Debrid-Link rejected that token.')).not.toBeInTheDocument();
		});
	});

	describe('device-code sign-in', () => {
		const deviceCode = {
			verification_url: 'https://debrid-link.fr/webapp/device',
			user_code: 'ABCD-1234',
			device_code: 'dc123',
			expires_in: 1800,
			interval: 0,
		};

		it('shows the user code and where to enter it', async () => {
			requestDebridLinkDeviceCode.mockResolvedValue(deviceCode);
			pollDebridLinkDeviceToken.mockResolvedValue(null);

			render(<DebridLinkLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Debrid-Link/ }));

			await waitFor(() =>
				expect(screen.getByTestId('dl-user-code')).toHaveTextContent('ABCD-1234')
			);
			expect(screen.getByRole('link')).toHaveAttribute(
				'href',
				'https://debrid-link.fr/webapp/device'
			);
		});

		it('stores the token under dl:accessToken, never dl:apiKey', async () => {
			requestDebridLinkDeviceCode.mockResolvedValue(deviceCode);
			pollDebridLinkDeviceToken.mockResolvedValue({
				access_token: 'oauth-tok',
				token_type: 'Bearer',
			});

			render(<DebridLinkLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Debrid-Link/ }));

			await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('oauth-tok'));
			expect(setApiKey).not.toHaveBeenCalled();
			expect(replace).toHaveBeenCalledWith('/');
		});

		// The real lifetime is unmeasured, so the expiry is recorded as an
		// absolute instant when the server offers one - that is what lets the
		// hook renew lazily instead of on a timer.
		it('records the refresh token and an absolute expiry when offered', async () => {
			requestDebridLinkDeviceCode.mockResolvedValue(deviceCode);
			pollDebridLinkDeviceToken.mockResolvedValue({
				access_token: 'oauth-tok',
				token_type: 'Bearer',
				refresh_token: 'rtok',
				expires_in: 604800,
			});
			const before = Date.now();

			render(<DebridLinkLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Debrid-Link/ }));

			await waitFor(() => expect(setRefreshToken).toHaveBeenCalledWith('rtok'));
			const [expiry] = setTokenExpiry.mock.calls[0];
			expect(expiry).toBeGreaterThanOrEqual(before + 604800 * 1000);
			expect(expiry).toBeLessThan(before + 604800 * 1000 + 60_000);
		});

		it('stores nothing to refresh when the response carries neither field', async () => {
			requestDebridLinkDeviceCode.mockResolvedValue(deviceCode);
			pollDebridLinkDeviceToken.mockResolvedValue({
				access_token: 'oauth-tok',
				token_type: 'Bearer',
			});

			render(<DebridLinkLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Debrid-Link/ }));

			await waitFor(() => expect(setAccessToken).toHaveBeenCalled());
			expect(setRefreshToken).not.toHaveBeenCalled();
			expect(setTokenExpiry).not.toHaveBeenCalled();
		});

		it('keeps polling while the user has not approved yet', async () => {
			requestDebridLinkDeviceCode.mockResolvedValue(deviceCode);
			pollDebridLinkDeviceToken
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ access_token: 'tok', token_type: 'Bearer' });

			render(<DebridLinkLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Debrid-Link/ }));

			await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('tok'));
			expect(pollDebridLinkDeviceToken).toHaveBeenCalledTimes(3);
		});

		it('says so plainly when the user declines on Debrid-Link', async () => {
			requestDebridLinkDeviceCode.mockResolvedValue(deviceCode);
			pollDebridLinkDeviceToken.mockRejectedValue(
				Object.assign(new Error('denied'), { error: 'access_denied' })
			);

			render(<DebridLinkLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Debrid-Link/ }));

			await waitFor(() => expect(screen.getByText(/You declined/)).toBeInTheDocument());
			expect(setAccessToken).not.toHaveBeenCalled();
		});

		it('still offers the paste-a-token path alongside it', () => {
			render(<DebridLinkLoginPage />);

			expect(screen.getByLabelText('API Token')).toBeInTheDocument();
			expect(
				screen.getByRole('button', { name: /Sign in with Debrid-Link/ })
			).toBeInTheDocument();
		});
	});
});
