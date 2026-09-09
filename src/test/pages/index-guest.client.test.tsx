import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUserMock = vi.fn();

const { handleLogoutMock, pushMock, toastMock } = vi.hoisted(() => ({
	handleLogoutMock: vi.fn(),
	pushMock: vi.fn(),
	toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
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
	MainActions: ({ isGuest }: { isGuest?: boolean }) => (
		<div data-testid="main-actions" data-guest={String(!!isGuest)} />
	),
}));

vi.mock('@/components/SearchBar', () => ({
	__esModule: true,
	SearchBar: () => <div data-testid="search-bar" />,
}));

vi.mock('@/components/ServiceCard', () => ({
	__esModule: true,
	ServiceCard: ({ service }: { service: string }) => (
		<div data-testid={`service-card-${service}`} />
	),
}));

vi.mock('@/components/TraktSection', () => ({
	__esModule: true,
	TraktSection: () => <div data-testid="trakt-section" />,
}));

vi.mock('@/components/ZurgBanner', () => ({
	__esModule: true,
	ZurgBanner: () => <div data-testid="zurg-banner" />,
}));

vi.mock('@/hooks/auth', () => ({
	__esModule: true,
	useCurrentUser: () => currentUserMock(),
	useDebridLogin: () => ({
		loginWithRealDebrid: vi.fn(),
		loginWithAllDebrid: vi.fn(),
		loginWithTorbox: vi.fn(),
		loginWithPremiumize: vi.fn(),
		loginWithOffcloud: vi.fn(),
		loginWithDebridLink: vi.fn(),
	}),
}));

vi.mock('@/hooks/castToken', () => ({
	__esModule: true,
	useCastToken: () => undefined,
}));

vi.mock('@/hooks/allDebridCastToken', () => ({
	__esModule: true,
	useAllDebridCastToken: () => undefined,
}));

vi.mock('@/hooks/torboxCastToken', () => ({
	__esModule: true,
	useTorBoxCastToken: () => undefined,
}));

vi.mock('@/utils/browseTerms', () => ({
	__esModule: true,
	getTerms: () => ['search-term'],
}));

vi.mock('@/utils/logout', () => ({
	__esModule: true,
	handleLogout: handleLogoutMock,
}));

vi.mock('@/utils/premiumCheck', () => ({
	__esModule: true,
	checkPremiumStatus: vi.fn().mockResolvedValue({ shouldLogout: false }),
}));

vi.mock('@/utils/toastOptions', () => ({
	__esModule: true,
	genericToastOptions: {},
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
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
	useRouter: () => ({ push: pushMock, prefetch: vi.fn(), replace: vi.fn(), asPath: '/' }),
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
	toast: toastMock,
	Toaster: () => null,
}));

import IndexPage from '@/pages/index';
import { GUEST_MODE_KEY } from '@/utils/guestMode';
import { handleLogout } from '@/utils/logout';

const DEBRID_SERVICES = ['rd', 'ad', 'tb', 'pm', 'oc', 'dl'];

const signedOutFixture = {
	rdUser: null,
	rdError: null,
	hasRDAuth: false,
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

describe('IndexPage in guest mode', () => {
	beforeEach(() => {
		localStorage.clear();
		pushMock.mockReset();
		handleLogoutMock.mockReset();
		currentUserMock.mockReset();
		currentUserMock.mockReturnValue(signedOutFixture);
	});

	it('says which parts of DMM a guest can use', () => {
		localStorage.setItem(GUEST_MODE_KEY, 'true');

		render(<IndexPage />);

		expect(screen.getByText('You are browsing as a guest')).toBeInTheDocument();
		expect(screen.getByTestId('main-actions')).toHaveAttribute('data-guest', 'true');
	});

	// The whole point of guest mode is that connecting a service later stays one
	// click away, so the cards are folded rather than dropped.
	it('folds the debrid cards away without removing them', () => {
		localStorage.setItem(GUEST_MODE_KEY, 'true');

		const { container } = render(<IndexPage />);

		const disclosure = container.querySelector('details');
		expect(disclosure).not.toBeNull();
		expect(disclosure?.open).toBe(false);
		expect(screen.getByText('Connect a debrid service')).toBeInTheDocument();

		for (const service of DEBRID_SERVICES) {
			expect(disclosure).toContainElement(screen.getByTestId(`service-card-${service}`));
		}

		// Trakt is not a debrid service and has nothing to do with the gate.
		expect(disclosure).not.toContainElement(screen.getByTestId('service-card-trakt'));
	});

	// Guest mode used to carry its own narrower exit beside this button, and the
	// pair read as one action: both landed on /start, and the only difference -
	// whether a linked DMM API key survived - was invisible from the labels.
	it('offers one way out, the same one everybody else gets', () => {
		localStorage.setItem(GUEST_MODE_KEY, 'true');

		render(<IndexPage />);

		expect(screen.queryByText('Exit guest mode')).toBeNull();
		expect(screen.queryByText('Logout All')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: /Clear browser data/i }));

		// handleLogout drops every key, guest mode included, then leaves on /start.
		expect(handleLogout).toHaveBeenCalledWith(undefined, expect.anything());
	});

	// Settings is why guest mode exists: it is where a sponsor links the DMM API
	// key that the Torznab and Newznab endpoints authenticate on.
	it('keeps the settings shortcut', () => {
		localStorage.setItem(GUEST_MODE_KEY, 'true');

		render(<IndexPage />);

		expect(screen.getByRole('link', { name: /Settings/i })).toHaveAttribute(
			'href',
			'/settings'
		);
	});

	it('shows a signed-in user the cards as before', () => {
		currentUserMock.mockReturnValue({
			...signedOutFixture,
			rdUser: { username: 'demo' },
			hasRDAuth: true,
		});

		const { container } = render(<IndexPage />);

		expect(container.querySelector('details')).toBeNull();
		expect(screen.queryByText('You are browsing as a guest')).toBeNull();
		expect(screen.getByTestId('main-actions')).toHaveAttribute('data-guest', 'false');
		for (const service of DEBRID_SERVICES) {
			expect(screen.getByTestId(`service-card-${service}`)).toBeInTheDocument();
		}
	});
});
