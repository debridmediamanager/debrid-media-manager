import {
	useAllDebridApiKey,
	useDebridLogin,
	usePremiumizeCredential,
	useRealDebridAccessToken,
	useTorBoxAccessToken,
} from '@/hooks/auth';
import StartPage from '@/pages/start';
import { fireEvent, render, screen } from '@testing-library/react';
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
}));

describe('StartPage', () => {
	let mockPush: any;
	let mockLoginWithRealDebrid: any;
	let mockLoginWithAllDebrid: any;
	let mockLoginWithTorbox: any;
	let mockLoginWithPremiumize: any;

	beforeEach(() => {
		mockPush = vi.fn();
		mockLoginWithRealDebrid = vi.fn();
		mockLoginWithAllDebrid = vi.fn();
		mockLoginWithTorbox = vi.fn();
		mockLoginWithPremiumize = vi.fn();

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
		});

		vi.mocked(useRealDebridAccessToken).mockReturnValue([null, false, false]);
		vi.mocked(useAllDebridApiKey).mockReturnValue(null);
		vi.mocked(useTorBoxAccessToken).mockReturnValue(null);
		vi.mocked(usePremiumizeCredential).mockReturnValue(null);
	});

	it('should render the start page correctly', () => {
		render(<StartPage />);

		expect(screen.getByText('Welcome to Debrid Media Manager')).toBeInTheDocument();
		expect(
			screen.getByText(
				'Start building your movie and TV show library with truly unlimited storage size'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText('Please login with one of the supported services below')
		).toBeInTheDocument();
	});

	it('should render all login buttons', () => {
		render(<StartPage />);

		expect(screen.getByText('Login with Real Debrid')).toBeInTheDocument();
		expect(screen.getByText('Login with AllDebrid')).toBeInTheDocument();
		expect(screen.getByText('Login with Torbox')).toBeInTheDocument();
		expect(screen.getByText('Login with Premiumize')).toBeInTheDocument();
	});

	it('should render account creation links', () => {
		render(<StartPage />);

		expect(screen.getByText('Create an account with RealDebrid')).toBeInTheDocument();
		expect(screen.getByText('Create an account with AllDebrid')).toBeInTheDocument();
		expect(screen.getByText('Create an account with Torbox')).toBeInTheDocument();
		expect(screen.getByText('Create an account with Premiumize')).toBeInTheDocument();
	});

	it('should render data storage policy', () => {
		render(<StartPage />);

		expect(screen.getByText('Data Storage Policy')).toBeInTheDocument();
		expect(
			screen.getByText(/Please note that no data or logs are stored on our servers/i)
		).toBeInTheDocument();
		expect(screen.getByText(/You can inspect every request if you want/i)).toBeInTheDocument();
		expect(
			screen.getByText(/Everything is stored on your browser's local storage/i)
		).toBeInTheDocument();
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

	it('should not redirect when user is not logged in', () => {
		render(<StartPage />);

		expect(mockPush).not.toHaveBeenCalled();
	});

	it('should render open source link with correct attributes', () => {
		render(<StartPage />);

		const githubLink = screen.getByText(
			'This website is open source and you can also run this on your own machine'
		);
		expect(githubLink).toHaveAttribute('target', '_blank');
		expect(githubLink).toHaveAttribute(
			'href',
			'https://github.com/debridmediamanager/debrid-media-manager'
		);
	});

	it('should render account creation links with correct attributes', () => {
		render(<StartPage />);

		const rdLink = screen.getByText('Create an account with RealDebrid');
		expect(rdLink).toHaveAttribute('target', '_blank');
		expect(rdLink).toHaveAttribute('rel', 'noopener noreferrer');
		expect(rdLink).toHaveAttribute('href', 'http://real-debrid.com/?id=11137529');

		const adLink = screen.getByText('Create an account with AllDebrid');
		expect(adLink).toHaveAttribute('target', '_blank');
		expect(adLink).toHaveAttribute('rel', 'noopener noreferrer');
		expect(adLink).toHaveAttribute('href', 'https://alldebrid.com/?uid=1kk5i&lang=en');

		const tbLink = screen.getByText('Create an account with Torbox');
		expect(tbLink).toHaveAttribute('target', '_blank');
		expect(tbLink).toHaveAttribute('rel', 'noopener noreferrer');
		expect(tbLink).toHaveAttribute(
			'href',
			'https://torbox.app/subscription?referral=74ffa560-7381-4a18-adb1-cef97378c670'
		);
	});

	it('should have correct page title and meta tags', () => {
		render(<StartPage />);

		const titleElement = document.querySelector<HTMLTitleElement>('title');
		expect(titleElement).toHaveTextContent('Debrid Media Manager - Home');

		const metaRobots = document.querySelector('meta[name="robots"]');
		expect(metaRobots).toHaveAttribute('content', 'index, nofollow');
	});

	it('should render logo SVG', () => {
		render(<StartPage />);

		const svg = document.querySelector('svg');
		expect(svg).toBeInTheDocument();
		expect(svg).toHaveAttribute('width', '200');
		expect(svg).toHaveAttribute('height', '200');
		expect(svg).toHaveAttribute('viewBox', '0 0 200 200');
	});

	it('should have correct CSS classes and styling', () => {
		render(<StartPage />);

		const pageContainer = document.querySelector<HTMLDivElement>(
			'.flex.h-screen.flex-col.items-center.justify-center'
		);
		expect(pageContainer).toBeInTheDocument();

		const loginButton = screen.getByText('Login with Real Debrid');
		expect(loginButton).toHaveClass(
			'm-2',
			'rounded',
			'bg-blue-500',
			'px-4',
			'py-2',
			'text-white',
			'hover:bg-blue-600'
		);
	});

	it('should handle multiple login tokens correctly', () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['rd-token', false, false]);
		vi.mocked(useAllDebridApiKey).mockReturnValue('ad-key');

		render(<StartPage />);

		expect(mockPush).toHaveBeenCalledWith('/');
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
