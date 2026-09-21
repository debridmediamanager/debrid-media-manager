import SimklCallbackPage from '@/pages/auth/simkl';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/router', () => ({ useRouter: vi.fn() }));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const setStored: Record<string, ReturnType<typeof vi.fn>> = {
	'simkl:accessToken': vi.fn(),
	'simkl:refreshToken': vi.fn(),
	'simkl:tokenExpiry': vi.fn(),
};
vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: (key: string) => [null, setStored[key] ?? vi.fn()],
}));

const exchangeSimklCode = vi.fn();
vi.mock('@/services/simkl', async () => {
	const actual = await vi.importActual<typeof import('@/services/simkl')>('@/services/simkl');
	return { ...actual, exchangeSimklCode: (...args: unknown[]) => exchangeSimklCode(...args) };
});

import { SIMKL_STATE_KEY, SIMKL_VERIFIER_KEY } from '@/utils/simklLogin';

const push = vi.fn();

const renderAt = (query: Record<string, string>, isReady = true) => {
	(useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
		isReady,
		query,
		push,
	});
	return render(<SimklCallbackPage />);
};

const park = (state = 'state-value') => {
	sessionStorage.setItem(SIMKL_VERIFIER_KEY, 'parked-verifier');
	sessionStorage.setItem(SIMKL_STATE_KEY, state);
};

describe('Simkl OAuth callback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sessionStorage.clear();
	});

	it('exchanges the code with the parked verifier and stores the tokens', async () => {
		park();
		exchangeSimklCode.mockResolvedValue({
			access_token: 'simkl_at_abc',
			refresh_token: 'simkl_rt_def',
			expires_in: 604800,
			token_type: 'Bearer',
		});

		renderAt({ code: 'auth-code', state: 'state-value' });

		await waitFor(() => expect(exchangeSimklCode).toHaveBeenCalledTimes(1));
		expect(exchangeSimklCode).toHaveBeenCalledWith({
			code: 'auth-code',
			codeVerifier: 'parked-verifier',
			redirectUri: `${window.location.origin}/auth/simkl`,
		});
		await waitFor(() =>
			expect(setStored['simkl:accessToken']).toHaveBeenCalledWith('simkl_at_abc', 604800)
		);
		expect(setStored['simkl:refreshToken']).toHaveBeenCalledWith('simkl_rt_def');
		await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
	});

	it('refuses a code whose state does not match the parked one', async () => {
		park('state-value');

		renderAt({ code: 'auth-code', state: 'someone-elses-state' });

		expect(await screen.findByText(/state did not match/i)).toBeInTheDocument();
		expect(exchangeSimklCode).not.toHaveBeenCalled();
	});

	it('refuses a code when no sign-in was started in this tab', async () => {
		renderAt({ code: 'auth-code', state: 'state-value' });

		expect(await screen.findByText(/did not start here/i)).toBeInTheDocument();
		expect(exchangeSimklCode).not.toHaveBeenCalled();
	});

	it('shows what Simkl said when the user declines consent', async () => {
		park();

		renderAt({ error: 'access_denied', error_description: 'The user denied the request' });

		expect(await screen.findByText(/The user denied the request/)).toBeInTheDocument();
		expect(exchangeSimklCode).not.toHaveBeenCalled();
	});

	it('spends the authorization code exactly once across re-renders', async () => {
		// Codes are single-use: a second exchange of the same one is a
		// guaranteed invalid_grant, and the user would see a failure on a
		// sign-in that had already succeeded.
		park();
		exchangeSimklCode.mockResolvedValue({
			access_token: 'simkl_at_abc',
			expires_in: 604800,
			token_type: 'Bearer',
		});

		const { rerender } = renderAt({ code: 'auth-code', state: 'state-value' });
		await waitFor(() => expect(exchangeSimklCode).toHaveBeenCalledTimes(1));
		rerender(<SimklCallbackPage />);
		rerender(<SimklCallbackPage />);

		expect(exchangeSimklCode).toHaveBeenCalledTimes(1);
	});

	it('waits for the router before touching the parked handshake', () => {
		park();
		renderAt({}, false);

		expect(exchangeSimklCode).not.toHaveBeenCalled();
		// Still parked: a premature read would have cleared it and broken the
		// exchange that follows once the query arrives.
		expect(sessionStorage.getItem(SIMKL_VERIFIER_KEY)).toBe('parked-verifier');
	});
});
