import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingLibraryIndicator from './FloatingLibraryIndicator';

// Mock the hooks
vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: vi.fn(),
	useAllDebridApiKey: vi.fn(),
	useTorBoxAccessToken: vi.fn(),
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

	// These flows are driven by the auth hooks, which useLocalStorage keeps in
	// step with storage events and the logout helpers. The indicator derives its
	// visibility from those hook values rather than reading localStorage itself,
	// so the tests move the hooks and re-render, exactly as production does.
	describe('Logout behavior', () => {
		it('hides once the auth hooks report the tokens are gone', async () => {
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);

			const { container, rerender } = render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();

			(useRealDebridAccessToken as any).mockReturnValue([null, false, false]);
			rerender(<FloatingLibraryIndicator />);

			await waitFor(() => {
				expect(container.firstChild).toBeNull();
			});
		});

		it('hides when every service token is cleared', async () => {
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useAllDebridApiKey as any).mockReturnValue('test-key');
			(useTorBoxAccessToken as any).mockReturnValue('test-key');

			const { container, rerender } = render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();

			(useRealDebridAccessToken as any).mockReturnValue([null, false, false]);
			(useAllDebridApiKey as any).mockReturnValue(null);
			(useTorBoxAccessToken as any).mockReturnValue(null);
			rerender(<FloatingLibraryIndicator />);

			await waitFor(() => {
				expect(container.firstChild).toBeNull();
			});
		});

		it('stays hidden for a token that is only whitespace', () => {
			(useRealDebridAccessToken as any).mockReturnValue(['   ', false, false]);

			const { container } = render(<FloatingLibraryIndicator />);
			expect(container.firstChild).toBeNull();
		});
	});

	describe('Login behavior', () => {
		it('shows once the auth hooks report a token', async () => {
			const { container, rerender } = render(<FloatingLibraryIndicator />);
			expect(container.firstChild).toBeNull();

			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			rerender(<FloatingLibraryIndicator />);

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
			(useRealDebridAccessToken as any).mockReturnValue(['test-token', false, false]);
			(useAllDebridApiKey as any).mockReturnValue('test-key');

			const { container, rerender } = render(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();

			// one service out, the other still signed in - stays visible
			(useRealDebridAccessToken as any).mockReturnValue([null, false, false]);
			rerender(<FloatingLibraryIndicator />);
			expect(screen.getByText('0')).toBeInTheDocument();

			(useAllDebridApiKey as any).mockReturnValue(null);
			rerender(<FloatingLibraryIndicator />);

			await waitFor(() => {
				expect(container.firstChild).toBeNull();
			});
		});
	});
});
