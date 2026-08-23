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

const setApiKey = vi.fn();
vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: () => [null, setApiKey],
}));

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

const submit = (key = 'ukf695qc73cqny3q') => {
	fireEvent.change(screen.getByLabelText('API Key'), { target: { value: key } });
	fireEvent.click(screen.getByRole('button', { name: 'Save API Key' }));
};

beforeEach(() => {
	setApiKey.mockReset();
	getPremiumizeAccountInfo.mockReset();
	replace.mockReset();
	vi.mocked(useRouter).mockReturnValue({ replace, query: {} } as any);
});

describe('PremiumizeLoginPage', () => {
	it('stores the key and redirects once Premiumize accepts it', async () => {
		getPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '704233992',
			premium_until: premiumUntil(86400),
			limit_used: 0,
			space_used: 0,
			booster_points: 0,
		});

		render(<PremiumizeLoginPage />);
		submit();

		await waitFor(() => expect(setApiKey).toHaveBeenCalledWith('ukf695qc73cqny3q'));
		expect(replace).toHaveBeenCalledWith('/');
	});

	it('trims the pasted key - Premiumize compares without trimming', async () => {
		getPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '704233992',
			premium_until: premiumUntil(86400),
			limit_used: 0,
			space_used: 0,
			booster_points: 0,
		});

		render(<PremiumizeLoginPage />);
		submit('  ukf695qc73cqny3q  ');

		await waitFor(() => expect(setApiKey).toHaveBeenCalledWith('ukf695qc73cqny3q'));
	});

	it('refuses a free account, which can resolve one link every two hours', async () => {
		getPremiumizeAccountInfo.mockResolvedValue({
			customer_id: '704233992',
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
});
