import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerMock = {
	query: {} as Record<string, string>,
	push: vi.fn(),
	replace: vi.fn(),
	prefetch: vi.fn(),
};

const fetchMock = vi.fn();

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ imdbId, title }: { imdbId: string; title?: string }) => (
		<div data-testid="poster">
			{imdbId}:{title}
		</div>
	),
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
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

import { clearCachedList } from '@/hooks/useCachedList';
import { TraktBrowse } from '@/pages/trakt/[browse]';

describe('Trakt browse page', () => {
	beforeEach(() => {
		clearCachedList();
		routerMock.query = {};
		fetchMock.mockReset();
		global.fetch = fetchMock as any;
	});

	it('shows loading state before the browse param is available', () => {
		render(<TraktBrowse />);
		expect(screen.getByText(/Loading/i)).toBeInTheDocument();
	});

	it('fetches browse data and renders category grids', async () => {
		routerMock.query = { browse: 'movies' };
		fetchMock.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					mediaType: 'movie',
					categories: [
						{
							name: 'Popular',
							results: {
								'List One': [
									{ movie: { ids: { imdb: 'tt101' }, title: 'Movie 101' } },
								],
							},
						},
					],
				}),
		});

		render(<TraktBrowse />);

		await waitFor(() =>
			expect(screen.getByRole('heading', { name: /Trakt - Movies/i })).toBeInTheDocument()
		);
		expect(fetchMock).toHaveBeenCalledWith('/api/info/trakt?browse=movies');
		expect(screen.getByText('tt101:Movie 101')).toBeInTheDocument();
	});

	it('shows an error when the API call fails', async () => {
		routerMock.query = { browse: 'shows' };
		fetchMock.mockRejectedValue(new Error('fail'));

		render(<TraktBrowse />);

		await waitFor(() => expect(screen.getByText(/Error:/i)).toBeInTheDocument());
	});
});
