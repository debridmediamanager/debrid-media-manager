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

	it('should render the back-to-show icon link', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

		const ShowInfoPage = (await import('@/pages/show/[imdbid]/info')).default;
		render(<ShowInfoPage />);

		const backLink = screen.getByRole('link', { name: 'Back to show' });
		expect(backLink).toHaveAttribute('href', '/show/tt9999999/1');
		expect(backLink).toHaveAttribute('title', 'Back to show');
	});

	// At 320px /show/tt…/info put "Game of Thrones", its icon buttons and
	// "Back to Show" on one non-wrapping row, which ran the link to 339px and
	// scrolled the page sideways (measured 2026-09-29).
	it('lets the title row wrap on a narrow screen', async () => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));

		const ShowInfoPage = (await import('@/pages/show/[imdbid]/info')).default;
		render(<ShowInfoPage />);

		const back = screen.getByRole('link', { name: 'Back to show' });
		expect(back.parentElement).toHaveClass('flex-wrap');
		expect(screen.getByRole('heading', { level: 1 })).toHaveClass('min-w-0', 'break-words');
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
		expect(screen.queryByText('Overview')).not.toBeInTheDocument();
		expect(screen.queryByText('Genres')).not.toBeInTheDocument();
		expect(screen.getByText('Drama')).toBeInTheDocument();
		expect(screen.getByText('Created by')).toBeInTheDocument();
		expect(screen.getByText('Creator One')).toBeInTheDocument();
		expect(
			screen.getByText('2023– · Returning · 3 seasons · 30 ep · ★ 9.1 (5.0k)')
		).toBeInTheDocument();
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

	// Cowboy Bebop showed raw ISO dates; a show without a last air date rendered a
	// blank "Last Air Date:" row (2026-10-25).
	const renderShow = async (overrides: Record<string, unknown>) => {
		const axios = (await import('axios')).default;
		vi.mocked(axios.get).mockImplementation((url: string) =>
			Promise.resolve({
				data: url.includes('show-details')
					? {
							title: 'Test Show',
							overview: '',
							firstAirDate: '1998-04-03',
							lastAirDate: '1999-04-24',
							numberOfSeasons: 1,
							numberOfEpisodes: 26,
							genres: [],
							voteAverage: 8.482,
							voteCount: 2058,
							posterPath: null,
							backdropPath: null,
							status: 'Ended',
							type: 'Scripted',
							cast: [],
							creators: [],
							...overrides,
						}
					: { trailer: '' },
			})
		);
		const ShowInfoPage = (await import('@/pages/show/[imdbid]/info')).default;
		render(<ShowInfoPage />);
		await screen.findByText('Test Show');
		return document.querySelector('main')!.textContent ?? '';
	};

	it('shows an ended run as a year span, with no raw ISO dates', async () => {
		const text = await renderShow({});
		expect(text).toContain('1998–1999 · Ended · 1 season · 26 ep · ★ 8.5 (2.1k)');
		expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
	});

	it('leaves out an empty last air date and a rating with no votes', async () => {
		const text = await renderShow({
			firstAirDate: '2026-10-15',
			lastAirDate: '',
			status: 'Returning Series',
			voteAverage: 0,
			voteCount: 0,
			numberOfEpisodes: 0,
		});
		expect(text).not.toMatch(/Last Air Date|0\.0\/10|0 votes|★|0 ep/);
		expect(text).toContain('2026– · Returning · 1 season');
	});
});
