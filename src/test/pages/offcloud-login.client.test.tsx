import OffcloudLoginPage from '@/pages/offcloud/login';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const getOffcloudAccountInfo = vi.fn();
vi.mock('@/services/offcloud', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/offcloud')>('@/services/offcloud');
	return {
		...actual,
		getOffcloudAccountInfo: (...args: unknown[]) => getOffcloudAccountInfo(...args),
	};
});

const replace = vi.fn();

const premiumAccount = {
	user_id: '100000001',
	email: 'me@example.com',
	is_premium: true,
	expiration_date: '2026-10-02',
	can_download: true,
};

const submit = (key = 'oc-test-api-key') => {
	fireEvent.change(screen.getByLabelText('API Key'), { target: { value: key } });
	fireEvent.click(screen.getByRole('button', { name: 'Save API Key' }));
};

beforeEach(() => {
	setApiKey.mockReset();
	getOffcloudAccountInfo.mockReset();
	replace.mockReset();
	vi.mocked(useRouter).mockReturnValue({ replace, query: {} } as any);
});

describe('OffcloudLoginPage', () => {
	it('stores the key under oc:apiKey and redirects once Offcloud accepts it', async () => {
		getOffcloudAccountInfo.mockResolvedValue(premiumAccount);

		render(<OffcloudLoginPage />);
		submit();

		await waitFor(() => expect(setApiKey).toHaveBeenCalledWith('oc-test-api-key'));
		expect(replace).toHaveBeenCalledWith('/');
	});

	it('returns the user to where they came from', async () => {
		vi.mocked(useRouter).mockReturnValue({ replace, query: { redirect: '/library' } } as any);
		getOffcloudAccountInfo.mockResolvedValue(premiumAccount);

		render(<OffcloudLoginPage />);
		submit();

		await waitFor(() => expect(replace).toHaveBeenCalledWith('/library'));
	});

	it('trims the pasted key', async () => {
		getOffcloudAccountInfo.mockResolvedValue(premiumAccount);

		render(<OffcloudLoginPage />);
		submit('  oc-test-api-key  ');

		await waitFor(() => expect(getOffcloudAccountInfo).toHaveBeenCalledWith('oc-test-api-key'));
		expect(setApiKey).toHaveBeenCalledWith('oc-test-api-key');
	});

	it('refuses a free account - only premium is served', async () => {
		getOffcloudAccountInfo.mockResolvedValue({ ...premiumAccount, is_premium: false });

		render(<OffcloudLoginPage />);
		submit();

		await waitFor(() => expect(screen.getByText(/not premium/i)).toBeInTheDocument());
		expect(setApiKey).not.toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
	});

	// NOAUTH is returned for a missing, malformed and revoked key alike, so the
	// page must not claim to know which one it was.
	it('reports a rejected key without guessing why', async () => {
		getOffcloudAccountInfo.mockRejectedValue(
			Object.assign(new Error('Offcloud account/info failed (401)'), { code: 'NOAUTH' })
		);

		render(<OffcloudLoginPage />);
		submit('nope');

		await waitFor(() =>
			expect(screen.getByText('Offcloud rejected that key.')).toBeInTheDocument()
		);
		expect(setApiKey).not.toHaveBeenCalled();
	});

	// An HTML answer under a 200 is a routing failure, not a bad key - telling
	// the user to check their key would send them chasing the wrong thing.
	it('surfaces a transport failure distinctly from a bad key', async () => {
		getOffcloudAccountInfo.mockRejectedValue(
			Object.assign(new Error('Offcloud answered 200 with text/html'), {
				code: 'non_json_response',
			})
		);

		render(<OffcloudLoginPage />);
		submit();

		await waitFor(() => expect(screen.getByText(/text\/html/)).toBeInTheDocument());
		expect(screen.queryByText('Offcloud rejected that key.')).not.toBeInTheDocument();
	});

	it('offers no OAuth path - Offcloud has none', () => {
		render(<OffcloudLoginPage />);

		expect(screen.getByLabelText('API Key')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Sign in with/ })).not.toBeInTheDocument();
	});
});
