import PremiumizeLoginPage from '@/pages/premiumize/login';
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
	'pm:apiKey': vi.fn(),
	'pm:accessToken': vi.fn(),
};
vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: (key: string) => [null, setStored[key] ?? vi.fn()],
}));

const requestPremiumizeDeviceCode = vi.fn();
const pollPremiumizeDeviceToken = vi.fn();
vi.mock('@/services/premiumizeOAuth', async () => {
	const actual = await vi.importActual<typeof import('@/services/premiumizeOAuth')>(
		'@/services/premiumizeOAuth'
	);
	return {
		...actual,
		requestPremiumizeDeviceCode: () => requestPremiumizeDeviceCode(),
		pollPremiumizeDeviceToken: (...a: unknown[]) => pollPremiumizeDeviceToken(...a),
	};
});

const getPremiumizeAccountInfo = vi.fn();
vi.mock('@/services/premiumize', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/premiumize')>('@/services/premiumize');
	return {
		...actual,
		getPremiumizeAccountInfo: (...args: unknown[]) => getPremiumizeAccountInfo(...args),
	};
});

const replace = vi.fn();

const premiumUntil = (offsetSeconds: number) => Math.floor(Date.now() / 1000) + offsetSeconds;

const submit = (key = 'pm-test-api-key') => {
	fireEvent.change(screen.getByLabelText('API Key'), { target: { value: key } });
	fireEvent.click(screen.getByRole('button', { name: 'Save API Key' }));
};

const setApiKey = setStored['pm:apiKey'];
const setAccessToken = setStored['pm:accessToken'];

beforeEach(() => {
	setApiKey.mockReset();
	setAccessToken.mockReset();
	requestPremiumizeDeviceCode.mockReset();
	pollPremiumizeDeviceToken.mockReset();
	getPremiumizeAccountInfo.mockReset();
	replace.mockReset();
	vi.mocked(useRouter).mockReturnValue({ replace, query: {} } as any);
});

describe('PremiumizeLoginPage', () => {
	it('stores the key and redirects once Premiumize accepts it', async () => {
		getPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '100000002',
			premium_until: premiumUntil(86400),
			limit_used: 0,
			space_used: 0,
			booster_points: 0,
		});

		render(<PremiumizeLoginPage />);
		submit();

		await waitFor(() => expect(setApiKey).toHaveBeenCalledWith('pm-test-api-key'));
		expect(replace).toHaveBeenCalledWith('/');
	});

	// `usePremiumizeCredential` prefers `pm:accessToken` over `pm:apiKey`, so a
	// key saved beside a stale token is never the one that gets sent. Someone
	// whose OAuth token died and who fixes it by pasting a fresh key would stay
	// broken with no feedback at all - the login says it worked and the home
	// page keeps failing.
	it('drops a superseded access token so the new key is the credential in use', async () => {
		getPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '100000002',
			premium_until: premiumUntil(86400),
			limit_used: 0,
			space_used: 0,
			booster_points: 0,
		});

		render(<PremiumizeLoginPage />);
		submit();

		await waitFor(() => expect(setApiKey).toHaveBeenCalledWith('pm-test-api-key'));
		expect(setAccessToken).toHaveBeenCalledWith(null);
	});

	it('leaves the access token alone when the key is rejected', async () => {
		getPremiumizeAccountInfo.mockRejectedValue(
			Object.assign(new Error('Not logged in.'), { code: 'authentication_failed' })
		);

		render(<PremiumizeLoginPage />);
		submit();

		await waitFor(() => expect(screen.getByText(/rejected that key/i)).toBeInTheDocument());
		expect(setAccessToken).not.toHaveBeenCalled();
		expect(setApiKey).not.toHaveBeenCalled();
	});

	it('trims the pasted key - Premiumize compares without trimming', async () => {
		getPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '100000002',
			premium_until: premiumUntil(86400),
			limit_used: 0,
			space_used: 0,
			booster_points: 0,
		});

		render(<PremiumizeLoginPage />);
		submit('  pm-test-api-key  ');

		await waitFor(() => expect(setApiKey).toHaveBeenCalledWith('pm-test-api-key'));
	});

	it('refuses a free account, which can resolve one link every two hours', async () => {
		getPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '100000002',
			premium_until: null,
			limit_used: 0,
			space_used: 0,
			booster_points: 0,
		});

		render(<PremiumizeLoginPage />);
		submit();

		await waitFor(() => expect(screen.getByText(/not premium/i)).toBeInTheDocument());
		expect(setApiKey).not.toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
	});

	it('reports a rejected key without guessing why - all three failures look alike', async () => {
		getPremiumizeAccountInfo.mockRejectedValue(
			Object.assign(new Error('Not logged in.'), { code: 'authentication_failed' })
		);

		render(<PremiumizeLoginPage />);
		submit('nope');

		await waitFor(() =>
			expect(screen.getByText('Premiumize rejected that key.')).toBeInTheDocument()
		);
		expect(setApiKey).not.toHaveBeenCalled();
	});

	it('surfaces a transport failure distinctly from a bad key', async () => {
		getPremiumizeAccountInfo.mockRejectedValue(
			Object.assign(new Error('socket hang up'), { code: 'transient_error' })
		);

		render(<PremiumizeLoginPage />);
		submit();

		await waitFor(() => expect(screen.getByText(/socket hang up/)).toBeInTheDocument());
	});

	describe('device-code sign-in', () => {
		const deviceCode = {
			verification_uri: 'https://www.premiumize.me/device',
			user_code: 'uwu3-67m4',
			device_code: 'dc123',
			expires_in: 600,
			interval: 0,
		};

		it('shows the user code and where to enter it', async () => {
			requestPremiumizeDeviceCode.mockResolvedValue(deviceCode);
			pollPremiumizeDeviceToken.mockResolvedValue(null);

			render(<PremiumizeLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Premiumize/ }));

			await waitFor(() =>
				expect(screen.getByTestId('pm-user-code')).toHaveTextContent('uwu3-67m4')
			);
			expect(screen.getByRole('link')).toHaveAttribute(
				'href',
				'https://www.premiumize.me/device'
			);
		});

		it('stores the token under pm:accessToken, never pm:apiKey', async () => {
			// The two are not interchangeable: only the API key opens WebDAV.
			requestPremiumizeDeviceCode.mockResolvedValue(deviceCode);
			pollPremiumizeDeviceToken.mockResolvedValue({
				access_token: 'oauth-tok',
				token_type: 'bearer',
				expires_in: 315360000,
				scope: 'full',
			});

			render(<PremiumizeLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Premiumize/ }));

			await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('oauth-tok'));
			expect(setApiKey).not.toHaveBeenCalled();
			expect(replace).toHaveBeenCalledWith('/');
		});

		it('keeps polling while the user has not approved yet', async () => {
			requestPremiumizeDeviceCode.mockResolvedValue(deviceCode);
			pollPremiumizeDeviceToken
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ access_token: 'tok', token_type: 'bearer' });

			render(<PremiumizeLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Premiumize/ }));

			await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('tok'));
			expect(pollPremiumizeDeviceToken).toHaveBeenCalledTimes(3);
		});

		it('says so plainly when the user declines on Premiumize', async () => {
			requestPremiumizeDeviceCode.mockResolvedValue(deviceCode);
			pollPremiumizeDeviceToken.mockRejectedValue(
				Object.assign(new Error('denied'), { error: 'access_denied' })
			);

			render(<PremiumizeLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: /Sign in with Premiumize/ }));

			await waitFor(() => expect(screen.getByText(/You declined/)).toBeInTheDocument());
			expect(setAccessToken).not.toHaveBeenCalled();
		});

		it('still offers the paste-a-key path alongside it', () => {
			render(<PremiumizeLoginPage />);
			expect(screen.getByLabelText('API Key')).toBeInTheDocument();
			expect(
				screen.getByRole('button', { name: /Sign in with Premiumize/ })
			).toBeInTheDocument();
		});
	});
});
