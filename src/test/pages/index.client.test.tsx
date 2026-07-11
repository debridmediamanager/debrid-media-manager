import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUserMock = vi.fn();

const { checkPremiumStatusMock, pushMock, toastMock } = vi.hoisted(() => ({
	checkPremiumStatusMock: vi.fn().mockResolvedValue({ shouldLogout: false }),
	pushMock: vi.fn(),
	toastMock: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock('@/components/BrowseSection', () => ({
	__esModule: true,
	BrowseSection: () => <div data-testid="browse-section" />,
}));

vi.mock('@/components/InfoSection', () => ({
	__esModule: true,
	InfoSection: () => <div data-testid="info-section" />,
}));

vi.mock('@/components/Logo', () => ({
	__esModule: true,
	Logo: () => <div data-testid="logo" />,
}));

vi.mock('@/components/MainActions', () => ({
	__esModule: true,
	MainActions: () => <div data-testid="main-actions" />,
}));

vi.mock('@/components/SearchBar', () => ({
	__esModule: true,
	SearchBar: () => <div data-testid="search-bar" />,
}));

vi.mock('@/components/ServiceCard', () => ({
	__esModule: true,
	ServiceCard: () => <div data-testid="service-card" />,
}));

vi.mock('@/components/TraktSection', () => ({
	__esModule: true,
	TraktSection: () => <div data-testid="trakt-section" />,
}));

vi.mock('@/hooks/auth', () => ({
	__esModule: true,
	useCurrentUser: () => currentUserMock(),
	useDebridLogin: () => ({
		loginWithRealDebrid: vi.fn(),
		loginWithAllDebrid: vi.fn(),
		loginWithTorbox: vi.fn(),
		loginWithTorrin: vi.fn(),
	}),
	useTorrinCreds: () => [null, null],
}));

vi.mock('@/hooks/castToken', () => ({
	__esModule: true,
	useCastToken: () => undefined,
}));

vi.mock('@/utils/browseTerms', () => ({
	__esModule: true,
	getTerms: () => ['search-term'],
}));

vi.mock('@/utils/logout', () => ({
	__esModule: true,
	handleLogout: vi.fn(),
}));

vi.mock('@/utils/premiumCheck', () => ({
	__esModule: true,
	checkPremiumStatus: () => checkPremiumStatusMock(),
}));

vi.mock('@/utils/toastOptions', () => ({
	__esModule: true,
	genericToastOptions: {},
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
}));

vi.mock('lucide-react', () => ({
	__esModule: true,
	Megaphone: () => <svg data-testid="megaphone-icon" />,
	Settings: () => <svg data-testid="settings-icon" />,
	Star: () => <svg data-testid="star-icon" />,
	X: () => <svg data-testid="x-icon" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children, ...rest }: any) => (
		<a href={typeof href === 'string' ? href : String(href)} {...rest}>
			{children}
		</a>
	),
}));

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => ({
		push: pushMock,
		prefetch: vi.fn(),
		replace: vi.fn(),
		asPath: '/',
	}),
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
	Toaster: () => null,
}));

import IndexPage from '@/pages/index';

describe('IndexPage', () => {
	beforeEach(() => {
		currentUserMock.mockReset();
		checkPremiumStatusMock.mockClear();
	});

	it('shows the MainActions component when an RD user is present', () => {
		currentUserMock.mockReturnValue({
			rdUser: { username: 'demo' },
			rdError: null,
			hasRDAuth: true,
			rdIsRefreshing: false,
			adUser: null,
			adError: null,
			hasADAuth: false,
			tbUser: null,
			tbError: null,
			hasTBAuth: false,
			traktUser: null,
			traktError: null,
			hasTraktAuth: false,
			isLoading: false,
		});

		render(<IndexPage />);

		// MainActions is mocked, verify it renders
		expect(screen.getByTestId('main-actions')).toBeTruthy();
	});

	it('shows the MainActions component when logged out', () => {
		currentUserMock.mockReturnValue({
			rdUser: null,
			rdError: null,
			hasRDAuth: false,
			rdIsRefreshing: false,
			adUser: null,
			adError: null,
			hasADAuth: false,
			tbUser: null,
			tbError: null,
			hasTBAuth: false,
			traktUser: null,
			traktError: null,
			hasTraktAuth: false,
			isLoading: false,
		});

		render(<IndexPage />);

		// MainActions is mocked, verify it still renders for logged out users
		expect(screen.getByTestId('main-actions')).toBeTruthy();
	});

	it('provides a shortcut to the settings page', () => {
		currentUserMock.mockReturnValue({
			rdUser: { username: 'demo' },
			rdError: null,
			hasRDAuth: true,
			rdIsRefreshing: false,
			adUser: null,
			adError: null,
			hasADAuth: false,
			tbUser: null,
			tbError: null,
			hasTBAuth: false,
			traktUser: null,
			traktError: null,
			hasTraktAuth: false,
			isLoading: false,
		});

		render(<IndexPage />);

		const settingsLink = screen.getByRole('link', { name: /Settings/i });
		expect(settingsLink).toHaveAttribute('href', '/settings');
	});

	it('keeps action buttons evenly spaced', () => {
		currentUserMock.mockReturnValue({
			rdUser: { username: 'demo' },
			rdError: null,
			hasRDAuth: true,
			rdIsRefreshing: false,
			adUser: null,
			adError: null,
			hasADAuth: false,
			tbUser: null,
			tbError: null,
			hasTBAuth: false,
			traktUser: null,
			traktError: null,
			hasTraktAuth: false,
			isLoading: false,
		});

		render(<IndexPage />);

		const refreshButton = screen.getByRole('button', { name: /Refresh/i });
		const clearCacheButton = screen.getByRole('button', { name: /Clear library cache/i });
		const logoutButton = screen.getByRole('button', { name: /Logout All/i });

		expect(refreshButton.className).toBe(clearCacheButton.className);
		expect(logoutButton.className).toBe(refreshButton.className);
		expect(refreshButton).toHaveClass('w-full');

		const container = refreshButton.parentElement;
		expect(container).not.toBeNull();
		expect(container).toHaveClass('grid');
		expect(container).toHaveClass('gap-3');
	});

	it('applies the same spacing while loading', () => {
		currentUserMock.mockReturnValue({
			rdUser: null,
			rdError: null,
			hasRDAuth: false,
			rdIsRefreshing: false,
			adUser: null,
			adError: null,
			hasADAuth: false,
			tbUser: null,
			tbError: null,
			hasTBAuth: false,
			traktUser: null,
			traktError: null,
			hasTraktAuth: false,
			isLoading: true,
		});

		render(<IndexPage />);

		const clearDataButton = screen.getByRole('button', { name: /Clear Data and Reload/i });

		expect(clearDataButton).toHaveClass('w-full');

		const container = clearDataButton.parentElement;
		expect(container).not.toBeNull();
		expect(container).toHaveClass('grid');
		expect(container).toHaveClass('gap-3');
	});
});
