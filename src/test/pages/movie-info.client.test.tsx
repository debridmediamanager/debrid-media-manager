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
	default: ({
		children,
		href,
		...props
	}: {
		children: ReactNode;
		href: string;
		[key: string]: unknown;
	}) => (
		<a href={href} {...props}>
			{children}
		</a>
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

	it('should render the back-to-movie icon link', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

		const MovieInfoPage = (await import('@/pages/movie/[imdbid]/info')).default;
		render(<MovieInfoPage />);

		const backLink = screen.getByRole('link', { name: 'Back to movie' });
		expect(backLink).toHaveAttribute('href', '/movie/tt1234567');
		expect(backLink).toHaveAttribute('title', 'Back to movie');
	});

	// At 320px /movie/tt…/info put "The Shawshank Redemption", its icon buttons and
	// "Back to Movie" on one non-wrapping row, which ran the link to 339px and
	// scrolled the page sideways (measured 2026-09-29).
	it('lets the title row wrap on a narrow screen', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

		const MovieInfoPage = (await import('@/pages/movie/[imdbid]/info')).default;
		render(<MovieInfoPage />);

		const back = screen.getByRole('link', { name: 'Back to movie' });
		expect(back.parentElement).toHaveClass('flex-wrap');
		expect(screen.getByRole('heading', { level: 1 })).toHaveClass('min-w-0', 'break-words');
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
		expect(screen.queryByText('Overview')).not.toBeInTheDocument();
		expect(screen.queryByText('Genres')).not.toBeInTheDocument();
		expect(screen.getByText('Action')).toBeInTheDocument();
		expect(screen.getByText('Directed by')).toBeInTheDocument();
		expect(screen.getByText('Test Director')).toBeInTheDocument();
		expect(screen.getByText(/2h 5m · ★ 8\.5 \(1\.0k\)/)).toBeInTheDocument();
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

	// The Matrix rendered "Release window reached" and a past "Digital Release" date;
	// Avengers: Doomsday rendered "0h 0m"-style zeros as "0.0/10 (0 votes)" (2026-10-25).
	const renderMovie = async (overrides: Record<string, unknown>) => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockImplementation((url: string) =>
			Promise.resolve({
				data: url.includes('movie-details')
					? {
							title: 'Test Movie',
							overview: '',
							releaseDate: '1999-03-31',
							digitalReleaseDate: '2020-07-15',
							expectedDigitalReleaseDate: '2020-07-15',
							expectedDigitalReleaseSource: 'tmdb',
							digitalReleaseAvailable: true,
							runtime: 136,
							genres: [],
							voteAverage: 8.3,
							voteCount: 28880,
							posterPath: null,
							backdropPath: null,
							cast: [],
							director: null,
							...overrides,
						}
					: { trailer: '' },
			})
		);
		const MovieInfoPage = (await import('@/pages/movie/[imdbid]/info')).default;
		render(<MovieInfoPage />);
		await screen.findByText('Test Movie');
		return document.querySelector('main')!.textContent ?? '';
	};

	it('drops a digital release that has already happened', async () => {
		const text = await renderMovie({});
		expect(text).not.toMatch(/Release window reached|Digital/);
		expect(text).toContain('2h 16m · ★ 8.3 (28.9k)');
	});

	it('hides zero runtime, a rating with no votes and an empty release date', async () => {
		const text = await renderMovie({
			releaseDate: '',
			runtime: 0,
			voteAverage: 0,
			voteCount: 0,
			digitalReleaseDate: '',
			expectedDigitalReleaseDate: '2999-01-30',
			expectedDigitalReleaseSource: 'estimated',
			digitalReleaseAvailable: false,
		});
		expect(text).not.toMatch(/0h 0m|0\.0\/10|0 votes|★|Release Date:|Runtime:/);
		expect(text).toMatch(/Digital .*2999 \(est\.\)/);
	});
});
