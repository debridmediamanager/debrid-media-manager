import {
	useAllDebridApiKey,
	useDebridLinkCredential,
	useDebridLogin,
	useOffcloudApiKey,
	usePremiumizeCredential,
	useRealDebridAccessToken,
	useTorBoxAccessToken,
} from '@/hooks/auth';
import StartPage from '@/pages/start';
import { GUEST_MODE_KEY } from '@/utils/guestMode';
import { REAL_DEBRID_REFERRAL_IDS } from '@/utils/referrals';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Next.js router
vi.mock('next/router', () => ({
	useRouter: vi.fn(),
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock auth hooks
vi.mock('@/hooks/auth', () => ({
	useDebridLogin: vi.fn(),
	useRealDebridAccessToken: vi.fn(),
	useAllDebridApiKey: vi.fn(),
	useTorBoxAccessToken: vi.fn(),
	usePremiumizeCredential: vi.fn(),
	useOffcloudApiKey: vi.fn(),
	useDebridLinkCredential: vi.fn(),
}));

describe('StartPage', () => {
	let mockPush: any;
	let mockLoginWithRealDebrid: any;
	let mockLoginWithAllDebrid: any;
	let mockLoginWithTorbox: any;
	let mockLoginWithPremiumize: any;
	let mockLoginWithOffcloud: any;
	let mockLoginWithDebridLink: any;

	beforeEach(() => {
		mockPush = vi.fn();
		mockLoginWithRealDebrid = vi.fn();
		mockLoginWithAllDebrid = vi.fn();
		mockLoginWithTorbox = vi.fn();
		mockLoginWithPremiumize = vi.fn();
		mockLoginWithOffcloud = vi.fn();
		mockLoginWithDebridLink = vi.fn();

		vi.mocked(useRouter).mockReturnValue({
			push: mockPush,
			pathname: '/start',
			query: {},
			asPath: '/start',
		} as any);

		vi.mocked(useDebridLogin).mockReturnValue({
			loginWithRealDebrid: mockLoginWithRealDebrid,
			loginWithAllDebrid: mockLoginWithAllDebrid,
			loginWithTorbox: mockLoginWithTorbox,
			loginWithPremiumize: mockLoginWithPremiumize,
			loginWithOffcloud: mockLoginWithOffcloud,
			loginWithDebridLink: mockLoginWithDebridLink,
		});

		vi.mocked(useRealDebridAccessToken).mockReturnValue([null, false, false]);
		vi.mocked(useAllDebridApiKey).mockReturnValue(null);
		vi.mocked(useTorBoxAccessToken).mockReturnValue(null);
		vi.mocked(usePremiumizeCredential).mockReturnValue(null);
		vi.mocked(useOffcloudApiKey).mockReturnValue(null);
		vi.mocked(useDebridLinkCredential).mockReturnValue(null);
	});

	it('should render the start page correctly', () => {
		render(<StartPage />);

		expect(screen.getByText('Welcome to Debrid Media Manager')).toBeInTheDocument();
		expect(
			screen.getByText('Build your movie and TV show library with truly unlimited storage')
		).toBeInTheDocument();
		expect(
			screen.getByText('Please login with one of the supported services below')
		).toBeInTheDocument();
	});

	it('should render all login buttons', () => {
		render(<StartPage />);

		expect(screen.getByRole('link', { name: 'Login with DMM key' })).toHaveAttribute(
			'href',
			'/sponsor/login'
		);
		expect(screen.getByText('Login with Real Debrid')).toBeInTheDocument();
		expect(screen.getByText('Login with AllDebrid')).toBeInTheDocument();
		expect(screen.getByText('Login with Torbox')).toBeInTheDocument();
		expect(screen.getByText('Login with Premiumize')).toBeInTheDocument();
		expect(screen.getByText('Login with Offcloud')).toBeInTheDocument();
		expect(screen.getByText('Login with Debrid-Link')).toBeInTheDocument();
	});

	it('should render account creation links', () => {
		render(<StartPage />);

		// For DMM itself, "Create account" means sponsoring, on gatekeeper.
		expect(
			screen.getByRole('link', { name: 'Become a sponsor on gatekeeper' })
		).toHaveAttribute('href', 'https://gatekeeper.debridmediamanager.com');
		expect(
			screen.getByRole('link', { name: 'Create an account with RealDebrid' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'Create an account with AllDebrid' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'Create an account with Torbox' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'Create an account with Premiumize' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'Create an account with Offcloud' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'Create an account with Debrid-Link' })
		).toBeInTheDocument();
	});

	it('should render data storage policy', () => {
		render(<StartPage />);

		const policy = screen.getByText(/No data or logs are stored on our servers/i);
		expect(policy).toHaveTextContent(/you can inspect every request/i);
		expect(policy).toHaveTextContent(/your browser's local storage/i);
	});

	it('links to zurg, rex, the docs and the community', () => {
		render(<StartPage />);

		const nav = screen.getByRole('navigation', { name: 'Other DMM sites' });
		expect(within(nav).getByRole('link', { name: 'Docs' })).toHaveAttribute(
			'href',
			'https://notes.debridmediamanager.com/'
		);
		expect(within(nav).getByRole('link', { name: 'Discord' })).toHaveAttribute(
			'href',
			'https://discord.com/invite/7u4YjMThXP'
		);
		expect(within(nav).getByRole('link', { name: 'Reddit' })).toHaveAttribute(
			'href',
			'https://www.reddit.com/r/debridmediamanager/'
		);
	});

	it('should call login functions when buttons are clicked', () => {
		render(<StartPage />);

		fireEvent.click(screen.getByText('Login with Real Debrid'));
		expect(mockLoginWithRealDebrid).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByText('Login with AllDebrid'));
		expect(mockLoginWithAllDebrid).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByText('Login with Torbox'));
		expect(mockLoginWithTorbox).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByText('Login with Premiumize'));
		expect(mockLoginWithPremiumize).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByText('Login with Offcloud'));
		expect(mockLoginWithOffcloud).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByText('Login with Debrid-Link'));
		expect(mockLoginWithDebridLink).toHaveBeenCalledTimes(1);
	});

	it('should redirect to home when user is logged in with Real-Debrid', () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['rd-token', false, false]);

		render(<StartPage />);

		expect(mockPush).toHaveBeenCalledWith('/');
	});

	it('should redirect to home when user is logged in with AllDebrid', () => {
		vi.mocked(useAllDebridApiKey).mockReturnValue('ad-key');

		render(<StartPage />);

		expect(mockPush).toHaveBeenCalledWith('/');
	});

	it('should redirect to home when user is logged in with TorBox', () => {
		vi.mocked(useTorBoxAccessToken).mockReturnValue('tb-token');

		render(<StartPage />);

		expect(mockPush).toHaveBeenCalledWith('/');
	});

	it('should redirect to home when user is logged in with Premiumize', () => {
		vi.mocked(usePremiumizeCredential).mockReturnValue('pm-key');

		render(<StartPage />);

		expect(mockPush).toHaveBeenCalledWith('/');
	});

	it('should redirect to home when user is logged in with Offcloud', () => {
		vi.mocked(useOffcloudApiKey).mockReturnValue('oc-key');

		render(<StartPage />);

		expect(mockPush).toHaveBeenCalledWith('/');
	});

	// Either Debrid-Link credential is a complete login, so the credential hook
	// is what this reads rather than one of the two keys behind it.
	it('should redirect to home when user is logged in with Debrid-Link', () => {
		vi.mocked(useDebridLinkCredential).mockReturnValue('dl-test-token');

		render(<StartPage />);

		expect(mockPush).toHaveBeenCalledWith('/');
	});

	it('should not redirect when user is not logged in', () => {
		render(<StartPage />);

		expect(mockPush).not.toHaveBeenCalled();
	});

	// No anonymous way in any more: a DMM key or an Easynews login is the
	// least a browser needs, and the guest flag alone opens nothing.
	describe('without a debrid account', () => {
		beforeEach(() => {
			localStorage.clear();
		});

		it('offers Easynews and the DMM key instead of entering as a guest', () => {
			render(<StartPage />);

			expect(screen.queryByText('Enter as Guest')).not.toBeInTheDocument();
			expect(screen.getByRole('link', { name: 'Login with Easynews' })).toHaveAttribute(
				'href',
				'/easynews/login?redirect=/'
			);
			expect(screen.getByRole('link', { name: 'Login with DMM key' })).toHaveAttribute(
				'href',
				'/sponsor/login'
			);
		});

		it('does not redirect a browser with a guest flag away from the login page', () => {
			localStorage.setItem(GUEST_MODE_KEY, 'true');

			render(<StartPage />);

			expect(mockPush).not.toHaveBeenCalled();
			expect(screen.getByText('Login with Real Debrid')).toBeInTheDocument();
		});
	});

	it('should render open source link with correct attributes', () => {
		render(<StartPage />);

		const githubLink = screen.getByText('Open source: run it on your own machine');
		expect(githubLink).toHaveAttribute('target', '_blank');
		expect(githubLink).toHaveAttribute(
			'href',
			'https://github.com/debridmediamanager/debrid-media-manager'
		);
	});

	it('should render account creation links with correct attributes', () => {
		render(<StartPage />);

		const rdLink = screen.getByRole('link', { name: 'Create an account with RealDebrid' });
		expect(rdLink).toHaveAttribute('target', '_blank');
		expect(rdLink).toHaveAttribute('rel', 'noopener noreferrer');
		const rdHref = rdLink.getAttribute('href') ?? '';
		const rdMatch = /^http:\/\/real-debrid\.com\/\?id=(\d+)$/.exec(rdHref);
		expect(rdMatch).not.toBeNull();
		expect(REAL_DEBRID_REFERRAL_IDS).toContain(rdMatch![1]);

		const adLink = screen.getByRole('link', { name: 'Create an account with AllDebrid' });
		expect(adLink).toHaveAttribute('target', '_blank');
		expect(adLink).toHaveAttribute('rel', 'noopener noreferrer');
		expect(adLink).toHaveAttribute('href', 'https://alldebrid.com/?uid=1kk5i&lang=en');

		const tbLink = screen.getByRole('link', { name: 'Create an account with Torbox' });
		expect(tbLink).toHaveAttribute('target', '_blank');
		expect(tbLink).toHaveAttribute('rel', 'noopener noreferrer');
		expect(tbLink).toHaveAttribute(
			'href',
			'https://torbox.app/subscription?referral=74ffa560-7381-4a18-adb1-cef97378c670'
		);

		const ocLink = screen.getByRole('link', { name: 'Create an account with Offcloud' });
		expect(ocLink).toHaveAttribute('target', '_blank');
		expect(ocLink).toHaveAttribute('rel', 'noopener noreferrer');
		expect(ocLink).toHaveAttribute('href', 'https://offcloud.com');

		const dlLink = screen.getByRole('link', { name: 'Create an account with Debrid-Link' });
		expect(dlLink).toHaveAttribute('target', '_blank');
		expect(dlLink).toHaveAttribute('rel', 'noopener noreferrer');
		expect(dlLink).toHaveAttribute('href', 'https://debrid-link.com/id/diG1t');
	});

	it('should have correct page title and meta tags', () => {
		render(<StartPage />);

		const titleElement = document.querySelector<HTMLTitleElement>('title');
		expect(titleElement).toHaveTextContent(
			'Debrid Media Manager · Curate an infinite media library'
		);

		const metaRobots = document.querySelector('meta[name="robots"]');
		expect(metaRobots).toHaveAttribute('content', 'noindex, nofollow');
	});

	it('should render logo SVG', () => {
		render(<StartPage />);

		const svg = document.querySelector('svg');
		expect(svg).toBeInTheDocument();
		expect(svg).toHaveAttribute('width', '88');
		expect(svg).toHaveAttribute('height', '88');
		expect(svg).toHaveAttribute('viewBox', '0 0 200 200');
	});

	it('should have correct CSS classes and styling', () => {
		render(<StartPage />);

		const pageContainer = document.querySelector<HTMLDivElement>(
			'.flex.min-h-screen.flex-col.items-center.justify-center'
		);
		expect(pageContainer).toBeInTheDocument();

		const loginButton = screen.getByText('Login with Real Debrid');
		expect(loginButton).toHaveClass(
			'rounded',
			'bg-blue-600',
			'px-2',
			'py-2',
			'text-white',
			'hover:bg-blue-700'
		);
	});

	it('should handle multiple login tokens correctly', () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['rd-token', false, false]);
		vi.mocked(useAllDebridApiKey).mockReturnValue('ad-key');

		render(<StartPage />);

		expect(mockPush).toHaveBeenCalledWith('/');
	});

	// A logged-out visitor lands here rather than on the index page, so the banner
	// has to be on this page too or most first-time visitors never see it.
	it('shows the zurg banner between the welcome copy and the login buttons', () => {
		render(<StartPage />);

		const banner = screen.getByRole('link', { name: 'Get zurg' });
		const heading = screen.getByRole('heading', { name: /Welcome to Debrid Media Manager/i });
		const loginPrompt = screen.getByText(/Please login with one of the supported services/i);
		expect(banner.getAttribute('href')).toContain('zurg.debridmediamanager.com');
		expect(
			heading.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			banner.compareDocumentPosition(loginPrompt) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('should prioritize redirect when multiple auth tokens exist', () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['rd-token', false, false]);
		vi.mocked(useAllDebridApiKey).mockReturnValue('ad-key');
		vi.mocked(useTorBoxAccessToken).mockReturnValue('tb-token');

		render(<StartPage />);

		// Should still only redirect once
		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith('/');
	});
});
