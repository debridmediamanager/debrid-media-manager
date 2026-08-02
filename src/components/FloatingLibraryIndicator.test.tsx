import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingLibraryIndicator from './FloatingLibraryIndicator';

// Mock the hooks
vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: vi.fn(),
	useAllDebridApiKey: vi.fn(),
	useTorBoxAccessToken: vi.fn(),
	useTorrinCreds: vi.fn(() => [null, null]),
}));

vi.mock('@/contexts/LibraryCacheContext', () => ({
	useLibraryCache: vi.fn(),
}));

vi.mock('next/router', () => ({
	useRouter: vi.fn(),
}));

// Import mocked modules
import { useLibraryCache } from '@/contexts/LibraryCacheContext';
import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import { useRouter } from 'next/router';

describe('FloatingLibraryIndicator', () => {
	const mockRouter = {
		pathname: '/',
		push: vi.fn(),
		reload: vi.fn(),
	};

	const mockLibraryCache = {
		libraryItems: [],
		isLoading: false,
		isFetching: false,
		lastFetchTime: null,
		error: null,
		refreshLibrary: vi.fn(),
	};

	beforeEach(() => {
		// Clear all mocks
		vi.clearAllMocks();
		localStorage.clear();

		// Setup default mocks
		(useRouter as any).mockReturnValue(mockRouter);
		(useLibraryCache as any).mockReturnValue(mockLibraryCache);
		(useRealDebridAccessToken as any).mockReturnValue([null, false, false]);
		(useAllDebridApiKey as any).mockReturnValue(null);
		(useTorBoxAccessToken as any).mockReturnValue(null);
	});

	describe('Visibility based on authentication', () => {
		it('should not render when user is not logged in', () => {
			const { container } = render(<FloatingLibraryIndicator />);
			expect(container.firstChild).toBeNull();
		});

		it('should render when user is logged in to RealDebrid', () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);

			render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();
		});

		it('should render when user is logged in to AllDebrid', () => {
			localStorage.setItem('ad:apiKey', 'test-key');
			(useAllDebridApiKey as any).mockReturnValue('test-key');

			render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();
		});

		it('should render when user is logged in to TorBox', () => {
			localStorage.setItem('tb:apiKey', 'test-key');
			(useTorBoxAccessToken as any).mockReturnValue('test-key');

			render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();
		});

		it('should not render on library page even when logged in', () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useRouter as any).mockReturnValue({ ...mockRouter, pathname: '/library' });

			const { container } = render(<FloatingLibraryIndicator />);
			expect(container.firstChild).toBeNull();
		});
	});

	describe('Logout behavior', () => {
		it('should hide immediately when logout event is dispatched', async () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);

			const { container } = render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();

			// Dispatch logout event
			act(() => {
				window.dispatchEvent(new Event('logout'));
			});

			await waitFor(() => {
				expect(container.firstChild).toBeNull();
			});
		});

		it('should hide when localStorage is cleared', async () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);

			const { container } = render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();

			// Clear localStorage and dispatch storage event
			act(() => {
				localStorage.removeItem('rd:accessToken');
				window.dispatchEvent(
					new StorageEvent('storage', {
						key: 'rd:accessToken',
						oldValue: 'test-token',
						newValue: null,
					})
				);
			});

			await waitFor(() => {
				expect(container.firstChild).toBeNull();
			});
		});

		it('should hide when all auth tokens are removed', async () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			localStorage.setItem('ad:apiKey', 'test-key');
			localStorage.setItem('tb:apiKey', 'test-key');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useAllDebridApiKey as any).mockReturnValue('test-key');
			(useTorBoxAccessToken as any).mockReturnValue('test-key');

			const { container } = render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();

			// Remove all tokens
			act(() => {
				localStorage.clear();
				window.dispatchEvent(new Event('logout'));
			});

			await waitFor(() => {
				expect(container.firstChild).toBeNull();
			});
		});
	});

	describe('Login behavior', () => {
		it('should show when login event is dispatched', async () => {
			const { container } = render(<FloatingLibraryIndicator />);
			expect(container.firstChild).toBeNull();

			// Add token and dispatch login event
			act(() => {
				localStorage.setItem('rd:accessToken', 'test-token');
				window.dispatchEvent(new Event('login'));
			});

			await waitFor(() => {
				expect(screen.getByText('0')).toBeInTheDocument();
			});
		});

		it('should show when auth token is added via storage event', async () => {
			const { container } = render(<FloatingLibraryIndicator />);
			expect(container.firstChild).toBeNull();

			// Add token via storage event
			act(() => {
				localStorage.setItem('rd:accessToken', 'test-token');
				window.dispatchEvent(
					new StorageEvent('storage', {
						key: 'rd:accessToken',
						oldValue: null,
						newValue: 'test-token',
					})
				);
			});

			await waitFor(() => {
				expect(screen.getByText('0')).toBeInTheDocument();
			});
		});
	});

	describe('Library data display', () => {
		it('should display library item count', () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useLibraryCache as any).mockReturnValue({
				...mockLibraryCache,
				libraryItems: [{ id: 1 }, { id: 2 }, { id: 3 }],
			});

			render(<FloatingLibraryIndicator />);
			expect(screen.getByText('3')).toBeInTheDocument();
		});

		it('should NOT trigger initial refresh (EnhancedLibraryCacheContext handles it)', async () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			const refreshLibrary = vi.fn().mockResolvedValue(undefined);
			(useLibraryCache as any).mockReturnValue({
				...mockLibraryCache,
				refreshLibrary,
			});

			render(<FloatingLibraryIndicator />);

			await waitFor(() => {
				expect(screen.getByText('0')).toBeInTheDocument();
			});

			expect(refreshLibrary).not.toHaveBeenCalled();
		});

		it('should show loading state', () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useLibraryCache as any).mockReturnValue({
				...mockLibraryCache,
				isLoading: true,
			});

			render(<FloatingLibraryIndicator />);
			expect(screen.getByText('Loading...')).toBeInTheDocument();
		});

		it('should show refreshing state', () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useLibraryCache as any).mockReturnValue({
				...mockLibraryCache,
				isFetching: true,
			});

			render(<FloatingLibraryIndicator />);
			expect(screen.getByText('Refreshing...')).toBeInTheDocument();
		});

		it('should show error indicator', () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useLibraryCache as any).mockReturnValue({
				...mockLibraryCache,
				error: 'Failed to fetch',
			});

			render(<FloatingLibraryIndicator />);
			expect(screen.getByTitle('Failed to fetch')).toBeInTheDocument();
		});

		it('updates last fetch label as time passes', () => {
			const baseTime = new Date('2024-01-01T00:00:00.000Z');
			vi.useFakeTimers();
			vi.setSystemTime(baseTime);
			localStorage.setItem('rd:accessToken', 'test-token');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useLibraryCache as any).mockReturnValue({
				...mockLibraryCache,
				lastFetchTime: baseTime,
			});

			try {
				render(<FloatingLibraryIndicator />);
				expect(screen.getByText('Just now')).toBeInTheDocument();
				act(() => {
					vi.advanceTimersByTime(61_000);
				});
				expect(screen.getByText('1m ago')).toBeInTheDocument();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('Multiple service support', () => {
		it('should remain visible when one service logs out but others remain', async () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			localStorage.setItem('ad:apiKey', 'test-key');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useAllDebridApiKey as any).mockReturnValue('test-key');

			render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();

			// Remove only RD token
			act(() => {
				localStorage.removeItem('rd:accessToken');
				window.dispatchEvent(
					new StorageEvent('storage', {
						key: 'rd:accessToken',
						oldValue: 'test-token',
						newValue: null,
					})
				);
			});

			// Should still be visible because AD is logged in
			await waitFor(() => {
				expect(screen.getByText('0')).toBeInTheDocument();
			});
		});

		it('should hide only when all services are logged out', async () => {
			localStorage.setItem('rd:accessToken', 'test-token');
			localStorage.setItem('ad:apiKey', 'test-key');
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useAllDebridApiKey as any).mockReturnValue('test-key');

			const { container } = render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();

			// Remove all tokens
			act(() => {
				localStorage.removeItem('rd:accessToken');
				localStorage.removeItem('ad:apiKey');
				window.dispatchEvent(
					new StorageEvent('storage', {
						key: 'ad:apiKey',
						oldValue: 'test-key',
						newValue: null,
					})
				);
			});

			await waitFor(() => {
				expect(container.firstChild).toBeNull();
			});
		});
	});
});
