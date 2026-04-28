import { render, screen } from '@testing-library/react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/router', () => ({
	useRouter: vi.fn(),
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock('axios', () => ({
	__esModule: true,
	default: {
		get: vi.fn(),
	},
}));

vi.mock('@/components/TrailerModal', () => ({
	__esModule: true,
	default: () => <div data-testid="trailer-modal" />,
}));

vi.mock('@/utils/genreMapping', () => ({
	formatGenreForUrl: (name: string) => name.toLowerCase(),
	mapTmdbGenreToTrakt: (name: string) => name,
}));

describe('MovieInfoPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			replace: vi.fn(),
			query: { imdbid: 'tt1234567' },
			pathname: '/movie/[imdbid]/info',
			asPath: '/movie/tt1234567/info',
			isReady: true,
			events: { on: vi.fn(), off: vi.fn() },
		} as any);
	});

	it('should show loading state initially', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

		const MovieInfoPage = (await import('@/pages/movie/[imdbid]/info')).default;
		render(<MovieInfoPage />);

		expect(screen.getByText('Loading...')).toBeInTheDocument();
	});

	it('should render Back to Movie link', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

		const MovieInfoPage = (await import('@/pages/movie/[imdbid]/info')).default;
		render(<MovieInfoPage />);

		const backLink = screen.getByText('Back to Movie');
		expect(backLink).toHaveAttribute('href', '/movie/tt1234567');
	});

	it('should show error message on fetch failure', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

		const MovieInfoPage = (await import('@/pages/movie/[imdbid]/info')).default;
		render(<MovieInfoPage />);

		const errorMsg = await screen.findByText('Failed to load movie details.');
		expect(errorMsg).toBeInTheDocument();
	});

	it('should render movie details on successful fetch', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockImplementation((url: string) => {
			if (url.includes('movie-details')) {
				return Promise.resolve({
					data: {
						title: 'Test Movie',
						overview: 'A great movie.',
						releaseDate: '2024-01-15',
						runtime: 125,
						genres: [{ id: 1, name: 'Action' }],
						voteAverage: 8.5,
						voteCount: 1000,
						posterPath: '/poster.jpg',
						backdropPath: null,
						cast: [],
						director: {
							name: 'Test Director',
							job: 'Director',
							department: 'Directing',
							slug: 'test-director',
						},
					},
				});
			}
			return Promise.resolve({ data: { trailer: '' } });
		});

		const MovieInfoPage = (await import('@/pages/movie/[imdbid]/info')).default;
		render(<MovieInfoPage />);

		expect(await screen.findByText('Test Movie')).toBeInTheDocument();
		expect(await screen.findByText('A great movie.')).toBeInTheDocument();
		expect(screen.getByText('Overview')).toBeInTheDocument();
		expect(screen.getByText('Genres')).toBeInTheDocument();
		expect(screen.getByText('Director')).toBeInTheDocument();
		expect(screen.getByText('Test Director')).toBeInTheDocument();
		expect(screen.getByText('2h 5m')).toBeInTheDocument();
	});

	it('should show no details message when data is null after loading', async () => {
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			replace: vi.fn(),
			query: { imdbid: '' },
			pathname: '/movie/[imdbid]/info',
			asPath: '/movie//info',
			isReady: true,
			events: { on: vi.fn(), off: vi.fn() },
		} as any);

		const MovieInfoPage = (await import('@/pages/movie/[imdbid]/info')).default;
		render(<MovieInfoPage />);

		expect(screen.getByText('No movie details found.')).toBeInTheDocument();
	});
});
