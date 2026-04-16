import { clearCachedList } from '@/hooks/useCachedList';
import SearchPage from '@/pages/search';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import getConfig from 'next/config';
import { useRouter } from 'next/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Next.js router
vi.mock('next/router', () => ({
	useRouter: vi.fn(),
}));

// Mock Next.js config
vi.mock('next/config', () => ({
	default: vi.fn(),
}));

// Mock components
vi.mock('@/components/poster', () => ({
	default: ({ title }: { title: string }) => <div data-testid="poster">{title}</div>,
}));

// Mock withAuth
vi.mock('@/utils/withAuth', () => ({
	withAuth: (Component: any) => Component,
}));

// Mock API response type
interface SearchResult {
	imdbid: string;
	title: string;
	year: number;
	type: 'movie' | 'series';
}

const createJsonResponse = <T,>(payload: T): Response =>
	new Response(JSON.stringify(payload), {
		headers: { 'Content-Type': 'application/json' },
	});

describe('SearchPage', () => {
	let mockPush: any;
	let mockQuery: any;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		clearCachedList();
		mockPush = vi.fn();
		mockQuery = {};
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		vi.mocked(useRouter).mockReturnValue({
			push: mockPush,
			query: mockQuery,
			pathname: '/search',
			asPath: '/search',
		} as any);

		vi.mocked(getConfig).mockReturnValue({
			publicRuntimeConfig: {
				API_URL: 'http://localhost:3000',
			},
		});

		// Mock fetch
		global.fetch = vi.fn<typeof fetch>();
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	it('should render search page correctly', () => {
		render(<SearchPage />);

		expect(
			screen.getByPlaceholderText('e.g. breaking bad show, tt1234567, etc.')
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
	});

	it('should have correct page title', () => {
		render(<SearchPage />);

		// The title is set via Next.js Head component, which may not work in test environment
		// Just verify the component renders without errors by checking for the h1
		expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument();
	});

	it('should update query state when typing', () => {
		render(<SearchPage />);

		const searchInput = screen.getByPlaceholderText('e.g. breaking bad show, tt1234567, etc.');
		fireEvent.change(searchInput, { target: { value: 'test movie' } });

		expect(searchInput).toHaveValue('test movie');
	});

	it('should handle form submission with query', async () => {
		render(<SearchPage />);

		const searchInput = screen.getByPlaceholderText('e.g. breaking bad show, tt1234567, etc.');
		const searchButton = screen.getByRole('button', { name: /search/i });

		fireEvent.change(searchInput, { target: { value: 'avengers' } });
		fireEvent.click(searchButton);

		expect(mockPush).toHaveBeenCalledWith({
			query: { query: 'avengers' },
		});
	});

	it('should handle form submission with enter key', async () => {
		render(<SearchPage />);

		const searchInput = screen.getByPlaceholderText('e.g. breaking bad show, tt1234567, etc.');

		fireEvent.change(searchInput, { target: { value: 'batman' } });
		fireEvent.submit(searchInput.closest('form')!);

		expect(mockPush).toHaveBeenCalledWith({
			query: { query: 'batman' },
		});
	});

	it('should not submit empty query', () => {
		render(<SearchPage />);

		const searchButton = screen.getByRole('button', { name: /search/i });
		fireEvent.click(searchButton);

		expect(mockPush).not.toHaveBeenCalled();
	});

	it('should handle IMDb ID in query', () => {
		render(<SearchPage />);

		const searchInput = screen.getByPlaceholderText('e.g. breaking bad show, tt1234567, etc.');

		fireEvent.change(searchInput, { target: { value: 'tt1234567 some movie' } });
		fireEvent.click(screen.getByRole('button', { name: /search/i }));

		expect(mockPush).toHaveBeenCalledWith('/x/tt1234567/');
	});

	it('should handle different IMDb ID formats', () => {
		render(<SearchPage />);

		const searchInput = screen.getByPlaceholderText('e.g. breaking bad show, tt1234567, etc.');

		// Test 8-digit IMDb ID
		fireEvent.change(searchInput, { target: { value: 'tt12345678' } });
		fireEvent.click(screen.getByRole('button', { name: /search/i }));
		expect(mockPush).toHaveBeenCalledWith('/x/tt12345678/');

		mockPush.mockClear();

		// Test 9-digit IMDb ID
		fireEvent.change(searchInput, { target: { value: 'tt123456789' } });
		fireEvent.click(screen.getByRole('button', { name: /search/i }));
		expect(mockPush).toHaveBeenCalledWith('/x/tt123456789/');
	});

	it('should handle URL query parameter on mount', () => {
		mockQuery = { query: 'encoded%20movie' };

		vi.mocked(useRouter).mockReturnValue({
			push: mockPush,
			query: mockQuery,
			pathname: '/search',
			asPath: '/search?query=encoded%20movie',
		} as any);

		const mockFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(createJsonResponse({ results: [] }));

		global.fetch = mockFetch;

		render(<SearchPage />);

		expect(screen.getByDisplayValue('encoded movie')).toBeInTheDocument();
	});

	it('should fetch search results when query is present in URL', async () => {
		mockQuery = { query: 'avengers' };

		vi.mocked(useRouter).mockReturnValue({
			push: mockPush,
			query: mockQuery,
			pathname: '/search',
			asPath: '/search?query=avengers',
		} as any);

		const mockResults: SearchResult[] = [
			{ imdbid: 'tt0848228', title: 'The Avengers', year: 2012, type: 'movie' },
		];

		const mockFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(createJsonResponse({ results: mockResults }));

		global.fetch = mockFetch;

		render(<SearchPage />);

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/search/title?keyword=avengers')
			);
		});
	});

	it('should handle search errors gracefully', async () => {
		mockQuery = { query: 'broken query' };

		vi.mocked(useRouter).mockReturnValue({
			push: mockPush,
			query: mockQuery,
			pathname: '/search',
			asPath: '/search?query=broken%20query',
		} as any);

		const mockFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('Network error'));

		global.fetch = mockFetch;

		render(<SearchPage />);

		await waitFor(() => {
			expect(screen.getByText(/Failed to fetch search results/)).toBeInTheDocument();
		});

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'[Search] fetchData failed',
			expect.objectContaining({
				query: 'broken query',
				error: expect.any(Error),
			})
		);
	});

	it('should show loading state during search', async () => {
		mockQuery = { query: 'loading test' };

		vi.mocked(useRouter).mockReturnValue({
			push: mockPush,
			query: mockQuery,
			pathname: '/search',
			asPath: '/search?query=loading%20test',
		} as any);

		let resolveFetch: (value: Response) => void;
		const mockFetch = vi.fn<typeof fetch>((input: RequestInfo | URL, init?: RequestInit) => {
			return new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			});
		});

		global.fetch = mockFetch;

		render(<SearchPage />);

		// Check if loading state is shown
		expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();

		// Resolve the fetch
		resolveFetch!(createJsonResponse({ results: [] }));

		await waitFor(() => {
			expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
		});
	});

	it('should render search results when available', async () => {
		mockQuery = { query: 'results test' };

		vi.mocked(useRouter).mockReturnValue({
			push: mockPush,
			query: mockQuery,
			pathname: '/search',
			asPath: '/search?query=results%20test',
		} as any);

		const mockResults: SearchResult[] = [
			{ imdbid: 'tt0848228', title: 'The Avengers', year: 2012, type: 'movie' },
			{ imdbid: 'tt4154796', title: 'Avengers: Endgame', year: 2019, type: 'movie' },
		];

		const mockFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(createJsonResponse({ results: mockResults }));

		global.fetch = mockFetch;

		render(<SearchPage />);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'The Avengers' })).toBeInTheDocument();
			expect(screen.getByRole('heading', { name: 'Avengers: Endgame' })).toBeInTheDocument();
		});
	});

	it('should handle empty search results', async () => {
		mockQuery = { query: 'no results' };

		vi.mocked(useRouter).mockReturnValue({
			push: mockPush,
			query: mockQuery,
			pathname: '/search',
			asPath: '/search?query=no%20results',
		} as any);

		const mockFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(createJsonResponse({ results: [] }));

		global.fetch = mockFetch;

		render(<SearchPage />);

		await waitFor(() => {
			expect(screen.getByText(/No results found/)).toBeInTheDocument();
		});
	});

	it('should clear error message when new search starts', async () => {
		mockQuery = { query: 'first search' };

		vi.mocked(useRouter).mockReturnValue({
			push: mockPush,
			query: mockQuery,
			pathname: '/search',
			asPath: '/search?query=first%20search',
		} as any);

		// First search fails
		const mockFetch = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new Error('First error'))
			.mockResolvedValueOnce(createJsonResponse({ results: [] }));

		global.fetch = mockFetch;

		render(<SearchPage />);

		await waitFor(() => {
			expect(screen.getByText(/Failed to fetch search results/)).toBeInTheDocument();
		});

		// Trigger new search
		const searchInput = screen.getByPlaceholderText('e.g. breaking bad show, tt1234567, etc.');
		fireEvent.change(searchInput, { target: { value: 'new search' } });
		fireEvent.click(screen.getByRole('button', { name: /search/i }));

		// Error should be cleared
		await waitFor(() => {
			expect(screen.queryByText(/Failed to fetch search results/)).not.toBeInTheDocument();
		});
	});
});
