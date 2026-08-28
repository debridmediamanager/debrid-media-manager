import RealDebridLoginPage from '@/pages/realdebrid/login';
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
	'rd:accessToken': vi.fn(),
	'rd:clientId': vi.fn(),
	'rd:clientSecret': vi.fn(),
	'rd:refreshToken': vi.fn(),
};
vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: (key: string) => [null, setStored[key] ?? vi.fn()],
}));

const getDeviceCode = vi.fn();
const getCredentials = vi.fn();
const getToken = vi.fn();
const getCurrentUser = vi.fn();
vi.mock('@/services/realDebrid', () => ({
	__esModule: true,
	getDeviceCode: () => getDeviceCode(),
	getCredentials: (...args: unknown[]) => getCredentials(...args),
	getToken: (...args: unknown[]) => getToken(...args),
	getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));

const replace = vi.fn();

const setAccessToken = setStored['rd:accessToken'];
const setClientId = setStored['rd:clientId'];
const setClientSecret = setStored['rd:clientSecret'];
const setRefreshToken = setStored['rd:refreshToken'];

const submit = (key = 'rd-api-key-example') => {
	fireEvent.change(screen.getByLabelText('API Key'), { target: { value: key } });
	fireEvent.click(screen.getByRole('button', { name: 'Save API Key' }));
};

const deviceCode = {
	device_code: 'dev-123',
	user_code: 'ABCD1234',
	verification_url: 'https://real-debrid.com/device',
	direct_verification_url: 'https://real-debrid.com/device?usercode=ABCD1234',
	expires_in: 600,
	// Zero keeps the poll loop on the microtask queue, so no clock is needed.
	interval: 0,
};

beforeEach(() => {
	Object.values(setStored).forEach((fn) => fn.mockReset());
	getDeviceCode.mockReset();
	getCredentials.mockReset();
	getToken.mockReset();
	getCurrentUser.mockReset();
	replace.mockReset();
	vi.mocked(useRouter).mockReturnValue({ replace, query: {} } as any);
	(navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
});

describe('RealDebridLoginPage', () => {
	it('stores a pasted key with no expiry - there is nothing to refresh it with', async () => {
		getCurrentUser.mockResolvedValue({ username: 'demo', type: 'premium' });

		render(<RealDebridLoginPage />);
		submit();

		await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('rd-api-key-example'));
		// A second argument would record an expiry the page cannot honour.
		expect(setAccessToken.mock.calls[0]).toHaveLength(1);
		expect(setRefreshToken).not.toHaveBeenCalled();
		expect(replace).toHaveBeenCalledWith('/');
	});

	it('trims the pasted key', async () => {
		getCurrentUser.mockResolvedValue({ username: 'demo' });

		render(<RealDebridLoginPage />);
		submit('  rd-api-key-example  ');

		await waitFor(() => expect(getCurrentUser).toHaveBeenCalledWith('rd-api-key-example'));
		expect(setAccessToken).toHaveBeenCalledWith('rd-api-key-example');
	});

	it('reports a rejected key', async () => {
		getCurrentUser.mockRejectedValue(
			Object.assign(new Error('Request failed with status code 401'), {
				response: { status: 401 },
			})
		);

		render(<RealDebridLoginPage />);
		submit('nope');

		await waitFor(() =>
			expect(screen.getByText('Real-Debrid rejected that API key.')).toBeInTheDocument()
		);
		expect(setAccessToken).not.toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
	});

	it('surfaces a transport failure distinctly from a bad key', async () => {
		getCurrentUser.mockRejectedValue(new Error('Network Error'));

		render(<RealDebridLoginPage />);
		submit();

		await waitFor(() => expect(screen.getByText(/Network Error/)).toBeInTheDocument());
		expect(setAccessToken).not.toHaveBeenCalled();
	});

	describe('device-code sign-in', () => {
		it('shows the user code and posts it to the verification page', async () => {
			getDeviceCode.mockResolvedValue(deviceCode);
			getCredentials.mockRejectedValue(new Error('authorization pending'));

			render(<RealDebridLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: 'Sign in with Real-Debrid' }));

			await waitFor(() =>
				expect(screen.getByTestId('rd-user-code')).toHaveTextContent('ABCD1234')
			);
			const form = screen.getByRole('button', { name: /Open real-debrid/ }).closest('form');
			expect(form).toHaveAttribute('action', 'https://real-debrid.com/device');
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABCD1234');
		});

		it('stores the device code before polling, so the refresher can renew later', async () => {
			getDeviceCode.mockResolvedValue(deviceCode);
			getCredentials.mockResolvedValue({ client_id: 'cid', client_secret: 'secret' });
			getToken.mockResolvedValue({ access_token: 'oauth-token', expires_in: 86400 });

			render(<RealDebridLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: 'Sign in with Real-Debrid' }));

			await waitFor(() => expect(setRefreshToken).toHaveBeenCalledWith('dev-123'));
			await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('oauth-token', 86400));
			expect(setClientId).toHaveBeenCalledWith('cid');
			expect(setClientSecret).toHaveBeenCalledWith('secret');
			expect(getToken).toHaveBeenCalledWith('cid', 'secret', 'dev-123');
			expect(replace).toHaveBeenCalledWith('/');
		});

		it('keeps polling while the user has not approved yet', async () => {
			// Real-Debrid errors an unapproved code rather than reporting pending,
			// so a throwing poll must not end the loop.
			getDeviceCode.mockResolvedValue(deviceCode);
			getCredentials
				.mockRejectedValueOnce(new Error('bad request'))
				.mockRejectedValueOnce(new Error('bad request'))
				.mockResolvedValueOnce({ client_id: 'cid', client_secret: 'secret' });
			getToken.mockResolvedValue({ access_token: 'oauth-token', expires_in: 86400 });

			render(<RealDebridLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: 'Sign in with Real-Debrid' }));

			await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('oauth-token', 86400));
			expect(getCredentials).toHaveBeenCalledTimes(3);
		});

		it('still offers the paste-a-key path alongside it', () => {
			render(<RealDebridLoginPage />);

			expect(screen.getByLabelText('API Key')).toBeInTheDocument();
			expect(
				screen.getByRole('button', { name: 'Sign in with Real-Debrid' })
			).toBeInTheDocument();
			expect(getDeviceCode).not.toHaveBeenCalled();
		});
	});
});
