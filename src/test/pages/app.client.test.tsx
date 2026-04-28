import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RouteHandler = (url: string) => void;

const mockRouter = {
	pathname: '/',
	asPath: '/',
	events: {
		on: vi.fn<(event: string, handler: RouteHandler) => void>(),
		off: vi.fn<(event: string, handler: RouteHandler) => void>(),
	},
	push: vi.fn(),
	replace: vi.fn(),
	reload: vi.fn(),
};

let routeChangeHandlers: Record<string, RouteHandler[]> = {
	routeChangeStart: [],
	routeChangeComplete: [],
};

const resetRouterState = () => {
	routeChangeHandlers = { routeChangeStart: [], routeChangeComplete: [] };
	mockRouter.events = {
		on: vi.fn((event: string, handler: RouteHandler) => {
			(routeChangeHandlers[event] ||= []).push(handler);
		}),
		off: vi.fn((event: string, handler: RouteHandler) => {
			const handlers = routeChangeHandlers[event];
			if (!handlers) return;
			const idx = handlers.indexOf(handler);
			if (idx >= 0) handlers.splice(idx, 1);
		}),
	};
	mockRouter.push = vi.fn();
	mockRouter.replace = vi.fn();
	mockRouter.reload = vi.fn();
	mockRouter.pathname = '/';
	mockRouter.asPath = '/';
};

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => mockRouter,
}));

vi.mock('@/components/FloatingLibraryIndicator', () => ({
	__esModule: true,
	default: () => <div data-testid="floating-indicator" />,
}));

vi.mock('@/components/modals/ModalContext', () => ({
	__esModule: true,
	ModalProvider: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="modal-provider">{children}</div>
	),
}));

vi.mock('@/contexts/LibraryCacheContext', () => ({
	__esModule: true,
	LibraryCacheProvider: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="library-provider">{children}</div>
	),
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import App from '@/pages/_app';

const renderApp = (Component: any) =>
	render(<App Component={Component} pageProps={{}} router={mockRouter as any} />);

describe('App', () => {
	beforeEach(() => {
		resetRouterState();
		sessionStorage.clear();
		vi.useRealTimers();
	});

	it('wraps non-auth routes with the library provider and indicator', () => {
		const Page = () => <div>Dashboard</div>;
		renderApp(Page);

		expect(screen.getByTestId('library-provider')).toBeInTheDocument();
		expect(screen.getByTestId('floating-indicator')).toBeInTheDocument();
		expect(mockRouter.events.on).toHaveBeenCalledWith('routeChangeStart', expect.any(Function));
		expect(mockRouter.events.on).toHaveBeenCalledWith(
			'routeChangeComplete',
			expect.any(Function)
		);
	});

	it('disables the library provider for auth routes and flagged components', () => {
		const Page = () => <div>Auth</div>;
		(Page as any).disableLibraryProvider = true;
		mockRouter.pathname = '/start';
		renderApp(Page);

		expect(screen.queryByTestId('library-provider')).toBeNull();
		expect(screen.queryByTestId('floating-indicator')).toBeNull();
	});

	it('stores scroll position on route changes and restores saved positions', async () => {
		vi.useFakeTimers();
		const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		Object.defineProperty(window, 'scrollY', { value: 42, writable: true });
		const Page = () => <div>Library</div>;
		sessionStorage.setItem('scrollPos_/library', '150');
		mockRouter.pathname = '/library';
		mockRouter.asPath = '/library';

		renderApp(Page);

		expect(routeChangeHandlers.routeChangeStart).toHaveLength(1);
		routeChangeHandlers.routeChangeStart[0]('/browse');
		expect(sessionStorage.getItem('scrollPos_/library')).toBe('42');

		vi.advanceTimersByTime(1000);
		expect(scrollToSpy).toHaveBeenCalled();

		scrollToSpy.mockRestore();
		vi.useRealTimers();
	});
});
