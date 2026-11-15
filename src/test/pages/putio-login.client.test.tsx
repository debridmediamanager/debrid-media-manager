import PutioLoginPage from '@/pages/putio/login';
import { PutioError } from '@/services/putio';
import recorded from '@/test/fixtures/putio/recorded-2026-11-15.json';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/router', () => ({ useRouter: vi.fn() }));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const setAccessToken = vi.fn();
vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: (key: string) => [null, key === 'pt:accessToken' ? setAccessToken : vi.fn()],
	notifyLocalStorageChange: vi.fn(),
}));

const requestPutioDeviceCode = vi.fn();
const checkPutioDeviceCode = vi.fn();
const getPutioAccountInfo = vi.fn();
vi.mock('@/services/putio', async () => {
	const actual = await vi.importActual<typeof import('@/services/putio')>('@/services/putio');
	return {
		...actual,
		requestPutioDeviceCode: (...a: unknown[]) => requestPutioDeviceCode(...a),
		checkPutioDeviceCode: (...a: unknown[]) => checkPutioDeviceCode(...a),
		getPutioAccountInfo: (...a: unknown[]) => getPutioAccountInfo(...a),
	};
});

const replace = vi.fn();
const POLL_MS = 5_000;

const pasteToken = (token = 'pt-test-token') => {
	fireEvent.change(screen.getByLabelText('OAuth Token'), { target: { value: token } });
	fireEvent.click(screen.getByRole('button', { name: 'Save OAuth Token' }));
};

const startDeviceLink = async () => {
	fireEvent.click(screen.getByRole('button', { name: 'Sign in with put.io' }));
	await waitFor(() => expect(screen.getByTestId('pt-user-code')).toHaveTextContent('TZLUOH'));
};

beforeEach(() => {
	setAccessToken.mockReset();
	requestPutioDeviceCode.mockReset();
	checkPutioDeviceCode.mockReset();
	getPutioAccountInfo.mockReset();
	replace.mockReset();
	vi.mocked(useRouter).mockReturnValue({ replace, query: {} } as any);
	requestPutioDeviceCode.mockResolvedValue({ code: 'TZLUOH' });
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('PutioLoginPage', () => {
	describe('device link', () => {
		it("uses DMM's own app id when none is configured", async () => {
			vi.stubEnv('NEXT_PUBLIC_PUTIO_APP_ID', '');
			render(<PutioLoginPage />);
			await startDeviceLink();
			expect(requestPutioDeviceCode).toHaveBeenCalledWith('10085');
		});

		it("uses a self-hosted copy's app id when one is set", async () => {
			vi.stubEnv('NEXT_PUBLIC_PUTIO_APP_ID', '4242');
			render(<PutioLoginPage />);
			await startDeviceLink();
			expect(requestPutioDeviceCode).toHaveBeenCalledWith('4242');
		});

		it('shows the code, links to put.io with it filled in, and stores the token once linked', async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			checkPutioDeviceCode
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce('tok-20-chars-000000');
			render(<PutioLoginPage />);
			await startDeviceLink();
			expect(screen.getByRole('link', { name: /app\.put\.io\/link/ })).toHaveAttribute(
				'href',
				'https://app.put.io/link?code=TZLUOH'
			);

			await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
			expect(setAccessToken).not.toHaveBeenCalled();
			await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
			await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('tok-20-chars-000000'));
			expect(replace).toHaveBeenCalledWith('/');
			// The same code every time: put.io says not to ask for a new one per attempt.
			expect(requestPutioDeviceCode).toHaveBeenCalledTimes(1);
			expect(checkPutioDeviceCode.mock.calls.every(([code]) => code === 'TZLUOH')).toBe(true);
		});

		it('keeps polling through a network error and offers a new code after a 404', async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			checkPutioDeviceCode
				.mockRejectedValueOnce(new PutioError('Could not reach put.io.', 'network_error'))
				.mockRejectedValueOnce(
					new PutioError('gone', recorded['transfer-missing'].body.error_type, 404)
				);
			render(<PutioLoginPage />);
			await startDeviceLink();

			await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
			await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
			await waitFor(() => expect(screen.getByText(/code expired/)).toBeInTheDocument());
			expect(checkPutioDeviceCode).toHaveBeenCalledTimes(2);
			expect(setAccessToken).not.toHaveBeenCalled();
			expect(screen.getByRole('button', { name: 'Sign in with put.io' })).toBeEnabled();
		});
	});

	describe('pasted token', () => {
		it('stores the trimmed token once put.io accepts it', async () => {
			getPutioAccountInfo.mockResolvedValue({
				user_id: 1,
				username: 'someone',
				account_status: 'active',
			});
			render(<PutioLoginPage />);
			pasteToken('  pt-test-token  ');
			await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('pt-test-token'));
			expect(getPutioAccountInfo).toHaveBeenCalledWith('pt-test-token');
			expect(replace).toHaveBeenCalledWith('/');
		});

		it('signs in an account with no plan (recorded)', async () => {
			getPutioAccountInfo.mockResolvedValue(recorded['account-info-unpaid'].body.info);
			render(<PutioLoginPage />);
			pasteToken();
			await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith('pt-test-token'));
		});

		it('says a rejected token was rejected and stores nothing', async () => {
			getPutioAccountInfo.mockRejectedValue(new PutioError('x', 'Unauthorized', 401));
			render(<PutioLoginPage />);
			pasteToken();
			await waitFor(() =>
				expect(screen.getByText('put.io rejected that token.')).toBeInTheDocument()
			);
			expect(setAccessToken).not.toHaveBeenCalled();
		});

		it('tells a failed check apart from a rejected token', async () => {
			getPutioAccountInfo.mockRejectedValue(
				new PutioError('Could not reach put.io.', 'network_error')
			);
			render(<PutioLoginPage />);
			pasteToken();
			await waitFor(() =>
				expect(screen.getByText(/Could not reach put.io/)).toBeInTheDocument()
			);
			expect(setAccessToken).not.toHaveBeenCalled();
		});
	});

	it('never asks for a password and says put.io did not make DMM', () => {
		render(<PutioLoginPage />);
		expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
		expect(screen.getByText(/put\.io did not make it/)).toBeInTheDocument();
	});
});
