import SimklCallbackPage from '@/pages/auth/simkl';
import type * as SimklService from '@/services/simkl';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import { StrictMode, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import denial from '../fixtures/simkl/oauth-error-query.json';
import approval from '../fixtures/simkl/oauth-success-query.json';

vi.mock('next/router', () => ({ useRouter: vi.fn() }));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const exchangeSimklCode = vi.fn();
vi.mock('@/services/simkl', async () => {
	const actual = await vi.importActual<typeof SimklService>('@/services/simkl');
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
	return render(
		<StrictMode>
			<SimklCallbackPage />
		</StrictMode>
	);
};

const park = (state = approval.state) => {
	sessionStorage.setItem(SIMKL_VERIFIER_KEY, 'parked-verifier');
	sessionStorage.setItem(SIMKL_STATE_KEY, state);
};

describe('Simkl OAuth callback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		exchangeSimklCode.mockReset();
		exchangeSimklCode.mockRejectedValue(new Error('Unapproved exchange reached provider'));
		sessionStorage.clear();
		localStorage.clear();
	});

	it('completes a single code exchange through StrictMode and re-renders', async () => {
		park();
		exchangeSimklCode.mockResolvedValue(undefined);

		const { rerender } = renderAt(approval);

		await waitFor(() => expect(exchangeSimklCode).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(localStorage.getItem('simkl:sessionChange')).not.toBeNull());
		expect(localStorage.getItem('simkl:accessToken')).toBeNull();
		expect(localStorage.getItem('simkl:refreshToken')).toBeNull();
		expect(localStorage.getItem('simkl:tokenExpiry')).toBeNull();
		await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
		rerender(
			<StrictMode>
				<SimklCallbackPage />
			</StrictMode>
		);
		expect(exchangeSimklCode).toHaveBeenCalledTimes(1);
	});

	it('refuses a code whose state does not match the parked one', async () => {
		park();

		renderAt({ ...approval, state: 'someone-elses-state' });

		expect(await screen.findByRole('button', { name: /Go Home/i })).toBeInTheDocument();
		expect(exchangeSimklCode).not.toHaveBeenCalled();
	});

	it('refuses a code when no sign-in was started in this tab', async () => {
		renderAt(approval);

		expect(await screen.findByRole('button', { name: /Go Home/i })).toBeInTheDocument();
		expect(exchangeSimklCode).not.toHaveBeenCalled();
	});

	it('shows what Simkl said when the user declines consent', async () => {
		park();

		renderAt(denial);

		expect(await screen.findByText('access_denied')).toBeInTheDocument();
		expect(exchangeSimklCode).not.toHaveBeenCalled();
		expect(sessionStorage.getItem(SIMKL_VERIFIER_KEY)).toBeNull();
		expect(sessionStorage.getItem(SIMKL_STATE_KEY)).toBeNull();
	});

	it('waits for the router before touching the parked handshake', () => {
		park();
		renderAt({}, false);

		expect(exchangeSimklCode).not.toHaveBeenCalled();
		// Still parked: a premature read would have cleared it and broken the
		// exchange that follows once the query arrives.
		expect(sessionStorage.getItem(SIMKL_VERIFIER_KEY)).toBe('parked-verifier');
	});

	it('offers recovery instead of waiting forever when no code is returned', async () => {
		park();
		renderAt({});
		expect(await screen.findByRole('button', { name: /Go Home/i })).toBeInTheDocument();
		expect(sessionStorage.getItem(SIMKL_VERIFIER_KEY)).toBeNull();
		expect(exchangeSimklCode).not.toHaveBeenCalled();
	});

	it('purges obsolete browser credentials after completing a backend session', async () => {
		park();
		localStorage.setItem('simkl:refreshToken', JSON.stringify('previous-account-refresh'));
		exchangeSimklCode.mockResolvedValue(undefined);
		renderAt(approval);
		await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
		expect(localStorage.getItem('simkl:refreshToken')).toBeNull();
	});

	it.each([undefined, 'https://simkl.com.attacker.example', 'https://simkl.com/'])(
		'rejects approval from a missing or nonmatching issuer (%s)',
		async (iss) => {
			park();
			const query: Record<string, string> = { ...approval };
			if (iss === undefined) delete query.iss;
			else query.iss = iss;
			renderAt(query);
			expect(exchangeSimklCode).not.toHaveBeenCalled();
			expect(sessionStorage.getItem(SIMKL_VERIFIER_KEY)).toBeNull();
			expect(localStorage.getItem('simkl:accessToken')).toBeNull();
			expect(await screen.findByRole('button', { name: /Go Home/i })).toBeInTheDocument();
		}
	);

	it('rejects an error callback with an untrusted issuer before showing provider errors', async () => {
		park();
		renderAt({ ...denial, iss: 'https://attacker.example' });
		expect(sessionStorage.getItem(SIMKL_VERIFIER_KEY)).toBeNull();
		expect(screen.queryByText('access_denied')).not.toBeInTheDocument();
		expect(exchangeSimklCode).not.toHaveBeenCalled();
		expect(await screen.findByRole('button', { name: /Go Home/i })).toBeInTheDocument();
	});

	it('rejects an error callback whose state does not match the parked handshake', async () => {
		park();
		renderAt({ ...denial, state: 'someone-elses-state' });
		expect(await screen.findByRole('button', { name: /Go Home/i })).toBeInTheDocument();
		expect(screen.queryByText('access_denied')).not.toBeInTheDocument();
		expect(exchangeSimklCode).not.toHaveBeenCalled();
	});
});
