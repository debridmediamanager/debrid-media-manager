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

describe('ShowInfoPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			replace: vi.fn(),
			query: { imdbid: 'tt9999999' },
			pathname: '/show/[imdbid]/info',
			asPath: '/show/tt9999999/info',
			isReady: true,
			events: { on: vi.fn(), off: vi.fn() },
		} as any);
	});

	it('should show loading state initially', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

		const ShowInfoPage = (await import('@/pages/show/[imdbid]/info')).default;
		render(<ShowInfoPage />);

		expect(screen.getByText('Loading...')).toBeInTheDocument();
	});

	it('should render Back to Show link', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

		const ShowInfoPage = (await import('@/pages/show/[imdbid]/info')).default;
		render(<ShowInfoPage />);

		const backLink = screen.getByText('Back to Show');
		expect(backLink).toHaveAttribute('href', '/show/tt9999999/1');
	});

	it('should show error message on fetch failure', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

		const ShowInfoPage = (await import('@/pages/show/[imdbid]/info')).default;
		render(<ShowInfoPage />);

		const errorMsg = await screen.findByText('Failed to load show details.');
		expect(errorMsg).toBeInTheDocument();
	});

	it('should render show details on successful fetch', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockImplementation((url: string) => {
			if (url.includes('show-details')) {
				return Promise.resolve({
					data: {
						title: 'Test Show',
						overview: 'A great show.',
						firstAirDate: '2023-05-01',
						lastAirDate: '2024-01-01',
						numberOfSeasons: 3,
						numberOfEpisodes: 30,
						genres: [{ id: 1, name: 'Drama' }],
						voteAverage: 9.1,
						voteCount: 5000,
						posterPath: '/poster.jpg',
						backdropPath: null,
						status: 'Returning Series',
						type: 'Scripted',
						cast: [],
						creators: [
							{
								name: 'Creator One',
								job: 'Creator',
								department: 'Writing',
								slug: 'creator-one',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { trailer: '' } });
		});

		const ShowInfoPage = (await import('@/pages/show/[imdbid]/info')).default;
		render(<ShowInfoPage />);

		expect(await screen.findByText('Test Show')).toBeInTheDocument();
		expect(await screen.findByText('A great show.')).toBeInTheDocument();
		expect(screen.getByText('Overview')).toBeInTheDocument();
		expect(screen.getByText('Genres')).toBeInTheDocument();
		expect(screen.getByText('Creators')).toBeInTheDocument();
		expect(screen.getByText('Creator One')).toBeInTheDocument();
		expect(screen.getByText('Returning Series')).toBeInTheDocument();
	});

	it('should show no details message when data is null after loading', async () => {
		vi.mocked(useRouter).mockReturnValue({
			push: vi.fn(),
			replace: vi.fn(),
			query: { imdbid: '' },
			pathname: '/show/[imdbid]/info',
			asPath: '/show//info',
			isReady: true,
			events: { on: vi.fn(), off: vi.fn() },
		} as any);

		const ShowInfoPage = (await import('@/pages/show/[imdbid]/info')).default;
		render(<ShowInfoPage />);

		expect(screen.getByText('No show details found.')).toBeInTheDocument();
	});
});
