import { act, render, screen } from '@testing-library/react';
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
	}),
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
	FolderTree: () => <svg data-testid="folder-tree-icon" />,
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
	// The page imports the named `toast` too, and reaches for it as soon as any
	// provider reports an error - which no test exercised before.
	toast: toastMock,
	Toaster: () => null,
}));

import IndexPage from '@/pages/index';

describe('IndexPage', () => {
	beforeEach(() => {
		currentUserMock.mockReset();
		checkPremiumStatusMock.mockClear();
	});

	const settledFixture = {
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
		pmUser: null,
		pmError: null,
		hasPMAuth: false,
		ocUser: null,
		ocError: null,
		hasOCAuth: false,
		dlUser: null,
		dlError: null,
		hasDLAuth: false,
		traktUser: null,
		traktError: null,
		hasTraktAuth: false,
		isLoading: false,
	};

	// The bug behind "Debrid Media Manager is loading..." forever: the page used
	// to wait for every configured provider to SUCCEED, so a provider that had
	// failed was indistinguishable from one still in flight and nothing ever
	// retried. A settled provider is one that answered either way.
	it('renders the page when a configured provider failed to load', () => {
		currentUserMock.mockReturnValue({
			...settledFixture,
			hasTBAuth: true,
			tbError: new Error('TorBox profile unavailable'),
		});

		render(<IndexPage />);

		expect(screen.getByTestId('main-actions')).toBeInTheDocument();
		expect(screen.queryByText(/Debrid Media Manager is loading/i)).not.toBeInTheDocument();
	});

	// The zurg banner sits directly under the page title and above the search bar,
	// so it reads as part of the header rather than as a bar bolted onto the top.
	it('puts the zurg banner between the title and the search bar', () => {
		currentUserMock.mockReturnValue(settledFixture);

		render(<IndexPage />);

		const banner = screen.getByRole('link', { name: 'Get zurg' });
		const title = screen.getByRole('heading', { name: /Debrid Media Manager/i });
		const searchBar = screen.getByTestId('search-bar');
		expect(banner.getAttribute('href')).toContain('zurg.debridmediamanager.com');
		expect(
			title.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			banner.compareDocumentPosition(searchBar) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('still waits while a configured provider is genuinely in flight', () => {
		currentUserMock.mockReturnValue({ ...settledFixture, hasTBAuth: true });

		render(<IndexPage />);

		expect(screen.getByText(/Debrid Media Manager is loading/i)).toBeInTheDocument();
	});

	// Settling depends on a promise resolving, and the incident that produced
	// this bug was a profile call parked behind a 5-minute rate-limit pause.
	// The wait has to be bounded or "settled" is just a slower way to hang.
	it('renders anyway once the wait is exhausted', () => {
		vi.useFakeTimers();
		try {
			currentUserMock.mockReturnValue({ ...settledFixture, hasTBAuth: true });

			render(<IndexPage />);
			expect(screen.getByText(/Debrid Media Manager is loading/i)).toBeInTheDocument();

			act(() => {
				vi.advanceTimersByTime(5000);
			});

			expect(screen.getByTestId('main-actions')).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
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
			// pending, not absent: this is the state the loading screen is for
			hasTBAuth: true,
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

	// Settings holds playback and cast preferences only - it can neither show
	// nor replace nor clear a provider credential. Sending a user there to
	// "verify the API key" is the same dead end as a retry-only error card: the
	// actions that fix a rejected key all live on the card itself.
	//
	// Every provider that can raise an error is listed, so a seventh cannot be
	// added later with advice that points somewhere the user cannot act. The
	// two destinations that do not work are Settings and "clear site data" -
	// the latter drops all seven accounts to fix one, which is the very dead
	// end the card's own logout exists to avoid.
	it.each([
		['rdError', 'Real-Debrid'],
		['adError', 'AllDebrid'],
		['tbError', 'Torbox'],
		['pmError', 'Premiumize'],
		['ocError', 'Offcloud'],
		['dlError', 'Debrid-Link'],
		['traktError', 'Trakt'],
	])('points a failed %s at its own card', (errorKey, label) => {
		currentUserMock.mockReturnValue({
			...settledFixture,
			[errorKey]: new Error('rejected'),
		});

		render(<IndexPage />);

		const messages = toastMock.error.mock.calls.map((call: any[]) => String(call[0]));
		const message = messages.find((text: string) => text.includes(label));
		expect(message).toBeDefined();
		expect(message).not.toMatch(/in Settings/i);
		expect(message).not.toMatch(/clear site data/i);
		expect(message).toMatch(/card below/i);
	});
});
