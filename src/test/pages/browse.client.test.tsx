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
import { Browse } from '@/pages/browse/[search]';

describe('Browse page', () => {
	beforeEach(() => {
		clearCachedList();
		routerMock.query = {};
		(fetchMock as any).mockReset();
		global.fetch = fetchMock as any;
	});

	it('shows genre shortcuts when no search is provided', () => {
		render(<Browse />);
		expect(screen.getByRole('heading', { name: /Browse/i })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Action' })).toHaveAttribute(
			'href',
			'/browse/genre/action'
		);
	});

	it('fetches and displays browse results for a query', async () => {
		routerMock.query = { search: 'matrix' };
		fetchMock.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					'Neo Picks': ['movie:tt0133093:The Matrix'],
				}),
		});

		render(<Browse />);

		expect(screen.getByText(/Loading/i)).toBeInTheDocument();

		await waitFor(() =>
			expect(screen.getByRole('heading', { name: /Neo Picks/i })).toBeInTheDocument()
		);
		expect(fetchMock).toHaveBeenCalledWith('/api/info/browse?search=matrix');
		expect(screen.getByText('tt0133093:The Matrix')).toBeInTheDocument();
	});

	it('renders an error state when fetching results fails', async () => {
		routerMock.query = { search: 'fail' };
		fetchMock.mockRejectedValue(new Error('boom'));

		render(<Browse />);

		await waitFor(() => expect(screen.getByText(/Error:/i)).toBeInTheDocument());
		expect(screen.getByText(/Failed to load data/i)).toBeInTheDocument();
	});
});
