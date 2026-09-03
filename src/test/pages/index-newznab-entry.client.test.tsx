import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUserMock = vi.fn();
const sponsorMock = vi.fn();

const { toastMock } = vi.hoisted(() => ({
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

vi.mock('@/hooks/useSponsor', () => ({
	__esModule: true,
	useSponsor: () => sponsorMock(),
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

vi.mock('lucide-react', () => ({
	__esModule: true,
	Megaphone: () => <svg data-testid="megaphone-icon" />,
	Settings: () => <svg data-testid="settings-icon" />,
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
	useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn(), asPath: '/' }),
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
	toast: toastMock,
	Toaster: () => null,
}));

import IndexPage from '@/pages/index';

const settledFixture = {
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
	pmUser: null,
	pmError: null,
	hasPMAuth: false,
	traktUser: null,
	traktError: null,
	hasTraktAuth: false,
	isLoading: false,
};

describe('IndexPage Usenet indexer entry', () => {
	beforeEach(() => {
		currentUserMock.mockReset();
		currentUserMock.mockReturnValue(settledFixture);
		sponsorMock.mockReset();
	});

	it('offers a sponsor the way in to the indexer setup page', () => {
		sponsorMock.mockReturnValue({ isSponsor: true });

		render(<IndexPage />);

		const link = screen.getByRole('link', { name: /Usenet Indexer/i });
		expect(link).toHaveAttribute('href', '/newznab');
		expect(link).toHaveTextContent('Prowlarr-compatible endpoint for sponsors');
	});

	// Cosmetic, not a security boundary - the endpoint checks the key itself -
	// but a link everyone can see is a link everyone reports as broken.
	it('shows nothing to everyone else', () => {
		sponsorMock.mockReturnValue({ isSponsor: false });

		render(<IndexPage />);

		expect(screen.queryByRole('link', { name: /Usenet Indexer/i })).toBeNull();
		expect(screen.queryByRole('link', { name: /newznab/i })).toBeNull();
		// The rest of the page is untouched by the gate.
		expect(screen.getByRole('link', { name: /Settings/i })).toHaveAttribute(
			'href',
			'/settings'
		);
	});

	it('keeps the entry next to the settings shortcut', () => {
		sponsorMock.mockReturnValue({ isSponsor: true });

		render(<IndexPage />);

		const settings = screen.getByRole('link', { name: /Settings/i });
		const indexer = screen.getByRole('link', { name: /Usenet Indexer/i });
		expect(
			settings.compareDocumentPosition(indexer) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(indexer.parentElement).toBe(settings.parentElement);
	});
});
