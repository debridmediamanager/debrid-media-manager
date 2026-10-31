import TorboxLoginPage from '@/pages/torbox/login';
import freePlan from '@/test/fixtures/torbox/user-me-free-plan-2026-10-09.json';
import { listSavedAccounts, parkCurrentAccount } from '@/utils/savedAccounts';
import { FREE_TORBOX_PLAN_MESSAGE } from '@/utils/torboxPlan';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useRouterMock, useLocalStorageMock, getUserDataMock, getSafeRedirectPathMock } = vi.hoisted(
	() => ({
		useRouterMock: vi.fn(),
		useLocalStorageMock: vi.fn(),
		getUserDataMock: vi.fn(),
		getSafeRedirectPathMock: vi.fn(),
	})
);

vi.mock('next/router', () => ({
	useRouter: useRouterMock,
}));

vi.mock('@/hooks/localStorage', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/hooks/localStorage')>()),
	default: useLocalStorageMock,
}));

vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return { clear: vi.fn() };
	}),
}));

vi.mock('@/services/torbox', () => ({
	getUserData: getUserDataMock,
}));

vi.mock('@/utils/router', () => ({
	getSafeRedirectPath: getSafeRedirectPathMock,
}));

describe('Torbox login page', () => {
	const replaceMock = vi.fn();
	const setApiKeyMock = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		useRouterMock.mockReturnValue({
			query: { redirect: '/library' },
			replace: replaceMock,
		});
		useLocalStorageMock.mockReturnValue([null, setApiKeyMock]);
		getSafeRedirectPathMock.mockReturnValue('/library');
		(window as any).open = vi.fn();
		localStorage.clear();
	});

	const submitApiKey = (value: string) => {
		render(<TorboxLoginPage />);
		fireEvent.change(screen.getByLabelText(/api key/i), { target: { value } });
		fireEvent.click(screen.getByRole('button', { name: /save api key/i }));
	};

	it('validates and stores the API key before redirecting', async () => {
		getUserDataMock.mockResolvedValue({ success: true });

		submitApiKey('tb-key');

		await waitFor(() => expect(getUserDataMock).toHaveBeenCalledWith('tb-key'));
		expect(setApiKeyMock).toHaveBeenCalledWith('tb-key');
		expect(replaceMock).toHaveBeenCalledWith('/library');
	});

	// /user/me answers a free plan normally; only the library and every other
	// call after it are refused, so the key has to be turned away here.
	it('refuses a free-plan key and says it needs a paid TorBox plan', async () => {
		getUserDataMock.mockResolvedValue(freePlan.body);

		submitApiKey('tb-key');

		expect(await screen.findByText(FREE_TORBOX_PLAN_MESSAGE)).toBeInTheDocument();
		expect(setApiKeyMock).not.toHaveBeenCalled();
		expect(replaceMock).not.toHaveBeenCalled();
	});

	it('surfaced API errors to the user', async () => {
		getUserDataMock.mockRejectedValue({
			message: 'bad key',
			response: { data: { message: 'invalid' }, status: 401 },
		});

		submitApiKey('tb-key');

		await waitFor(() =>
			expect(screen.getByText(/API Error: invalid. Status: 401/i)).toBeInTheDocument()
		);
	});

	it('opens the Torbox settings link', () => {
		render(<TorboxLoginPage />);
		fireEvent.click(screen.getByRole('button', { name: /get api key/i }));
		expect(window.open).toHaveBeenCalledWith('https://torbox.app/settings', '_blank');
	});

	// "Add another account" parks the signed-in login and sends the user here
	describe('with a parked account', () => {
		const realLocation = window.location;
		const assign = vi.fn();

		beforeEach(() => {
			Object.defineProperty(window, 'location', {
				configurable: true,
				writable: true,
				value: { ...realLocation, assign },
			});
		});

		afterEach(() => {
			Object.defineProperty(window, 'location', {
				configurable: true,
				writable: true,
				value: realLocation,
			});
		});

		it('continues as the parked account and lands on the login redirect', async () => {
			localStorage.setItem('tb:apiKey', '"first-key"');
			localStorage.setItem('tb:castToken', '"first-cast"');
			await parkCurrentAccount('tb:', { id: '1055483', label: 'first' });
			expect(localStorage.getItem('tb:apiKey')).toBeNull();

			render(<TorboxLoginPage />);
			expect(await screen.findByText('Continue as')).toBeInTheDocument();
			fireEvent.click(screen.getByRole('button', { name: 'first' }));

			await waitFor(() => expect(assign).toHaveBeenCalledWith('/library'));
			expect(getSafeRedirectPathMock).toHaveBeenCalledWith('/library', '/');
			expect(localStorage.getItem('tb:apiKey')).toBe('"first-key"');
			expect(localStorage.getItem('tb:castToken')).toBe('"first-cast"');
			expect(listSavedAccounts('tb:')).toEqual([]);
			expect(replaceMock).not.toHaveBeenCalled();
		});

		it('shows no account row when nothing is parked', () => {
			render(<TorboxLoginPage />);
			expect(screen.queryByText('Continue as')).not.toBeInTheDocument();
			expect(screen.getByRole('button', { name: /save api key/i })).toBeInTheDocument();
		});
	});
});
