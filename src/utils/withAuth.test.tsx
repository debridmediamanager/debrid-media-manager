import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withAuth } from './withAuth';

const mockPush = vi.fn();
const mockRouter = {
	pathname: '/test',
	asPath: '/test?param=value',
	push: mockPush,
};

const mockUseRealDebridAccessToken = vi.fn();
const mockUseAllDebridApiKey = vi.fn();
const mockSupportsLookbehind = vi.fn();

vi.mock('next/router', () => ({
	useRouter: () => mockRouter,
}));

vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: () => mockUseRealDebridAccessToken(),
	useAllDebridApiKey: () => mockUseAllDebridApiKey(),
}));

vi.mock('./lookbehind', () => ({
	supportsLookbehind: () => mockSupportsLookbehind(),
}));

vi.mock('@/components/Logo', () => ({
	Logo: () => <div data-testid="logo">Logo</div>,
}));

describe('withAuth', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
		mockRouter.pathname = '/test';
		mockRouter.asPath = '/test?param=value';
		mockSupportsLookbehind.mockReturnValue(true);
	});

	it('renders wrapped component when authenticated with RD', async () => {
		mockUseRealDebridAccessToken.mockReturnValue(['rd-token', false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(screen.getByTestId('test-component')).toBeInTheDocument();
		});
	});

	it('renders wrapped component when authenticated with AD', async () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue('ad-key');

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(screen.getByTestId('test-component')).toBeInTheDocument();
		});
	});

	it('renders wrapped component when authenticated with TB', async () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		localStorage.setItem('tb:apiKey', 'tb-key');

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(screen.getByTestId('test-component')).toBeInTheDocument();
		});
	});

	// Offcloud's only credential is this key. Left out of the guard, an
	// Offcloud-only user is bounced to /start on every page, forever.
	it('renders wrapped component when authenticated with OC', async () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		localStorage.setItem('oc:apiKey', 'oc-key');

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(screen.getByTestId('test-component')).toBeInTheDocument();
		});
		expect(mockPush).not.toHaveBeenCalledWith('/start');
	});

	// Debrid-Link has two credentials and either one is a complete login, so
	// both have to count here or a signed-in user is bounced forever.
	it('renders wrapped component when authenticated with a DL OAuth token', async () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		localStorage.setItem('dl:accessToken', 'dl-test-token');

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(screen.getByTestId('test-component')).toBeInTheDocument();
		});
		expect(mockPush).not.toHaveBeenCalledWith('/start');
	});

	it('renders wrapped component when authenticated with a pasted DL token', async () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		localStorage.setItem('dl:apiKey', 'dl-test-token');

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(screen.getByTestId('test-component')).toBeInTheDocument();
		});
		expect(mockPush).not.toHaveBeenCalledWith('/start');
	});

	it('redirects to start route when not authenticated', async () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		mockRouter.pathname = '/some-page';

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(mockPush).toHaveBeenCalledWith('/start');
		});
	});

	it('stores return URL before redirecting to start', async () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		mockRouter.asPath = '/library?genre=action';
		mockRouter.pathname = '/library';

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(localStorage.getItem('dmm_return_url')).toBe('/library?genre=action');
		});
	});

	it('does not redirect when on start route', () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		mockRouter.pathname = '/start';

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		expect(mockPush).not.toHaveBeenCalled();
	});

	it('does not redirect when on login route', () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		mockRouter.pathname = '/realdebrid/login';

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		expect(mockPush).not.toHaveBeenCalled();
	});

	it('does not redirect when RD token is refreshing', () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, true]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		mockRouter.pathname = '/some-page';

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		expect(mockPush).not.toHaveBeenCalled();
	});

	it('does not redirect when has refresh credentials', () => {
		mockUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);
		localStorage.setItem('rd:refreshToken', 'refresh');
		localStorage.setItem('rd:clientId', 'client');
		localStorage.setItem('rd:clientSecret', 'secret');
		mockRouter.pathname = '/some-page';

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		expect(mockPush).not.toHaveBeenCalled();
	});

	it('redirects to return URL when authenticated', async () => {
		localStorage.setItem('dmm_return_url', '/library?genre=action');
		mockUseRealDebridAccessToken.mockReturnValue(['rd-token', false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(mockPush).toHaveBeenCalledWith('/library?genre=action');
		});
		expect(localStorage.getItem('dmm_return_url')).toBeNull();
	});

	it('does not redirect to start route as return URL', async () => {
		localStorage.setItem('dmm_return_url', '/start');
		mockUseRealDebridAccessToken.mockReturnValue(['rd-token', false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(screen.getByTestId('test-component')).toBeInTheDocument();
		});
		expect(mockPush).not.toHaveBeenCalledWith('/start');
	});

	it('does not redirect to login route as return URL', async () => {
		localStorage.setItem('dmm_return_url', '/realdebrid/login');
		mockUseRealDebridAccessToken.mockReturnValue(['rd-token', false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);

		const TestComponent = () => <div data-testid="test-component">Test Content</div>;
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent />);

		await waitFor(() => {
			expect(screen.getByTestId('test-component')).toBeInTheDocument();
		});
		expect(mockPush).not.toHaveBeenCalledWith('/realdebrid/login');
	});

	it('passes props to wrapped component', async () => {
		mockUseRealDebridAccessToken.mockReturnValue(['rd-token', false, false]);
		mockUseAllDebridApiKey.mockReturnValue(null);

		interface TestProps {
			testProp: string;
		}
		const TestComponent = ({ testProp }: TestProps) => (
			<div data-testid="test-component">{testProp}</div>
		);
		const WrappedComponent = withAuth(TestComponent);

		render(<WrappedComponent testProp="test value" />);

		await waitFor(() => {
			expect(screen.getByText('test value')).toBeInTheDocument();
		});
	});
});
