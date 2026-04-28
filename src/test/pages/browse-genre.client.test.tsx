import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerMock = {
	query: {} as Record<string, string>,
	push: vi.fn(),
	replace: vi.fn(),
	prefetch: vi.fn(),
};

const traktMocks = vi.hoisted(() => ({
	getTrendingByGenre: vi.fn(),
	getPopularByGenre: vi.fn(),
}));

const { runtimeConfig } = vi.hoisted(() => ({
	runtimeConfig: { traktClientId: 'client-id' },
}));

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ imdbId, title }: { imdbId: string; title: string }) => (
		<div data-testid="poster">
			{imdbId}:{title}
		</div>
	),
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
}));

vi.mock('@/services/trakt', () => ({
	__esModule: true,
	getTrendingByGenre: (...args: any[]) => traktMocks.getTrendingByGenre(...args),
	getPopularByGenre: (...args: any[]) => traktMocks.getPopularByGenre(...args),
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	Toaster: () => <div data-testid="toast" />,
}));

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => routerMock,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

vi.mock('next/config', () => ({
	__esModule: true,
	default: () => ({ publicRuntimeConfig: runtimeConfig }),
}));

import { clearCachedList } from '@/hooks/useCachedList';
import { Genre } from '@/pages/browse/genre/[genre]';

describe('Browse genre page', () => {
	beforeEach(() => {
		clearCachedList();
		routerMock.query = {};
		traktMocks.getTrendingByGenre.mockReset();
		traktMocks.getPopularByGenre.mockReset();
	});

	it('shows loading state when genre is not specified', () => {
		render(<Genre />);
		expect(screen.getByText(/Loading/i)).toBeInTheDocument();
	});

	it('fetches and renders genre sections', async () => {
		routerMock.query = { genre: 'genre:anime' };
		const movieItem = { movie: { ids: { imdb: 'tt11111' }, title: 'Anime Movie' } };
		const showItem = { show: { ids: { imdb: 'tt22222' }, title: 'Anime Show' } };
		traktMocks.getTrendingByGenre.mockResolvedValueOnce([movieItem]);
		traktMocks.getTrendingByGenre.mockResolvedValueOnce([showItem]);
		traktMocks.getPopularByGenre.mockResolvedValueOnce([movieItem]);
		traktMocks.getPopularByGenre.mockResolvedValueOnce([showItem]);

		render(<Genre />);

		await waitFor(() =>
			expect(screen.getByRole('heading', { name: /Trending Movies/i })).toBeInTheDocument()
		);
		expect(traktMocks.getTrendingByGenre).toHaveBeenCalledWith('client-id', 'anime', 'movies');
		expect(screen.getAllByTestId('poster')).toHaveLength(4);
	});

	it('renders an error message when the Trakt calls fail', async () => {
		routerMock.query = { genre: 'genre:bad' };
		traktMocks.getTrendingByGenre.mockRejectedValue(new Error('fail'));

		render(<Genre />);

		await waitFor(() => expect(screen.getByText(/Error:/i)).toBeInTheDocument());
	});
});
