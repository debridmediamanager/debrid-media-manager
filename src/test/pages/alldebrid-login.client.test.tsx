import AllDebridLoginPage from '@/pages/alldebrid/login';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/router', () => ({ useRouter: vi.fn() }));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const setApiKey = vi.fn();
vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: () => [null, setApiKey],
}));

const getPin = vi.fn();
const checkPinOnce = vi.fn();
const getAllDebridUser = vi.fn();
vi.mock('@/services/allDebrid', () => ({
	__esModule: true,
	getPin: () => getPin(),
	checkPinOnce: (...args: unknown[]) => checkPinOnce(...args),
	getAllDebridUser: (...args: unknown[]) => getAllDebridUser(...args),
}));

const replace = vi.fn();

const submit = (key = 'ad-api-key-example') => {
	fireEvent.change(screen.getByLabelText('API Key'), { target: { value: key } });
	fireEvent.click(screen.getByRole('button', { name: 'Save API Key' }));
};

/** The PIN poll is a fixed five seconds, so the clock has to be driven. */
const advance = async (ms: number) => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
};

const pin = {
	pin: '1234',
	check: 'check-token',
	user_url: 'https://alldebrid.com/pin/?pin=1234',
	expires_in: 600,
	base_url: 'https://alldebrid.com/pin/',
};

beforeEach(() => {
	setApiKey.mockReset();
	getPin.mockReset();
	checkPinOnce.mockReset();
	getAllDebridUser.mockReset();
	replace.mockReset();
	vi.mocked(useRouter).mockReturnValue({ replace, query: {} } as any);
	(navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
});

afterEach(() => {
	vi.useRealTimers();
});

describe('AllDebridLoginPage', () => {
	it('stores the key and redirects once AllDebrid accepts it', async () => {
		getAllDebridUser.mockResolvedValue({ username: 'demo', isPremium: true });

		render(<AllDebridLoginPage />);
		submit();

		await waitFor(() => expect(setApiKey).toHaveBeenCalledWith('ad-api-key-example'));
		expect(replace).toHaveBeenCalledWith('/');
	});

	it('trims the pasted key', async () => {
		getAllDebridUser.mockResolvedValue({ username: 'demo' });

		render(<AllDebridLoginPage />);
		submit('  ad-api-key-example  ');

		await waitFor(() => expect(getAllDebridUser).toHaveBeenCalledWith('ad-api-key-example'));
		expect(setApiKey).toHaveBeenCalledWith('ad-api-key-example');
	});

	it('says the key was rejected only when AllDebrid says it was', async () => {
		getAllDebridUser.mockRejectedValue(
			Object.assign(new Error('The auth apikey is invalid'), { code: 'AUTH_BAD_APIKEY' })
		);

		render(<AllDebridLoginPage />);
		submit('nope');

		await waitFor(() =>
			expect(screen.getByText('AllDebrid rejected that key.')).toBeInTheDocument()
		);
		expect(setApiKey).not.toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
	});

	it('passes any other refusal through - a blocked key is not a wrong key', async () => {
		// AUTH_BLOCKED is per-caller, so telling the user their key is wrong
		// would send them to regenerate a key that was fine.
		getAllDebridUser.mockRejectedValue(
			Object.assign(new Error('This endpoint is blocked'), { code: 'AUTH_BLOCKED' })
		);

		render(<AllDebridLoginPage />);
		submit();

		await waitFor(() =>
			expect(screen.getByText(/This endpoint is blocked/)).toBeInTheDocument()
		);
		expect(setApiKey).not.toHaveBeenCalled();
	});

	describe('PIN sign-in', () => {
		it('shows the PIN and where to enter it', async () => {
			vi.useFakeTimers();
			getPin.mockResolvedValue(pin);
			checkPinOnce.mockResolvedValue({ activated: false, expires_in: 600 });

			render(<AllDebridLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: 'Sign in with AllDebrid' }));
			await advance(0);

			expect(screen.getByTestId('ad-pin-code')).toHaveTextContent('1234');
			expect(screen.getByRole('link')).toHaveAttribute('href', pin.user_url);
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('1234');
		});

		it('stores the key the PIN hands back and redirects', async () => {
			vi.useFakeTimers();
			getPin.mockResolvedValue(pin);
			checkPinOnce.mockResolvedValue({ activated: true, apikey: 'pin-key', expires_in: 600 });

			render(<AllDebridLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: 'Sign in with AllDebrid' }));
			await advance(5000);

			expect(setApiKey).toHaveBeenCalledWith('pin-key');
			expect(replace).toHaveBeenCalledWith('/');
		});

		it('keeps polling while the user has not approved yet', async () => {
			vi.useFakeTimers();
			getPin.mockResolvedValue(pin);
			checkPinOnce
				.mockResolvedValueOnce({ activated: false, expires_in: 600 })
				.mockResolvedValueOnce({ activated: false, expires_in: 600 })
				.mockResolvedValueOnce({ activated: true, apikey: 'pin-key', expires_in: 600 });

			render(<AllDebridLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: 'Sign in with AllDebrid' }));
			await advance(15000);

			expect(checkPinOnce).toHaveBeenCalledTimes(3);
			expect(setApiKey).toHaveBeenCalledWith('pin-key');
		});

		it('gives up when the PIN ages out instead of polling forever', async () => {
			vi.useFakeTimers();
			getPin.mockResolvedValue({ ...pin, expires_in: 10 });
			checkPinOnce.mockResolvedValue({ activated: false, expires_in: 10 });

			render(<AllDebridLoginPage />);
			fireEvent.click(screen.getByRole('button', { name: 'Sign in with AllDebrid' }));
			await advance(15000);

			expect(screen.getByText(/PIN expired/)).toBeInTheDocument();
			expect(setApiKey).not.toHaveBeenCalled();
			expect(checkPinOnce).toHaveBeenCalledTimes(2);
		});

		it('still offers the paste-a-key path alongside it', () => {
			render(<AllDebridLoginPage />);

			expect(screen.getByLabelText('API Key')).toBeInTheDocument();
			expect(
				screen.getByRole('button', { name: 'Sign in with AllDebrid' })
			).toBeInTheDocument();
			expect(getPin).not.toHaveBeenCalled();
		});
	});
});
