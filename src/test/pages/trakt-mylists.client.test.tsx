import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { personalListsMock, likedListsMock, fetchListItemsMock, storedValues } = vi.hoisted(() => ({
	personalListsMock: vi.fn(),
	likedListsMock: vi.fn(),
	fetchListItemsMock: vi.fn(),
	storedValues: new Map<string, any>(),
}));

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ imdbId, title }: { imdbId: string; title: string }) => (
		<div data-testid="poster">
			{imdbId}:{title}
		</div>
	),
}));

vi.mock('@/hooks/localStorage', () => ({
	__esModule: true,
	default: (key: string) => [
		storedValues.get(key) ?? null,
		(newValue: any) => {
			const resolved =
				typeof newValue === 'function' ? newValue(storedValues.get(key) ?? null) : newValue;
			storedValues.set(key, resolved);
		},
	],
}));

vi.mock('@/services/trakt', () => ({
	__esModule: true,
	getUsersPersonalLists: (...args: any[]) => personalListsMock(...args),
	getLikedLists: (...args: any[]) => likedListsMock(...args),
	fetchListItems: (...args: any[]) => fetchListItemsMock(...args),
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	Toaster: () => <div data-testid="toast" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

import TraktMyListsPage from '@/pages/trakt/mylists';

describe('TraktMyLists page', () => {
	beforeEach(() => {
		storedValues.clear();
		personalListsMock.mockReset();
		likedListsMock.mockReset();
		fetchListItemsMock.mockReset();
	});

	it('shows a prompt when the user is not authenticated with Trakt', () => {
		render(<TraktMyListsPage />);

		expect(personalListsMock).not.toHaveBeenCalled();
		expect(screen.getByRole('option', { name: 'Select a list' })).toBeInTheDocument();
	});

	it('loads personal and liked lists and renders their items', async () => {
		storedValues.set('trakt:accessToken', 'token123');
		storedValues.set('trakt:userSlug', 'user-slug');

		personalListsMock.mockResolvedValue([{ name: 'Favorites', ids: { trakt: 1 } }]);
		likedListsMock.mockResolvedValue([
			{
				list: {
					name: 'Community Picks',
					ids: { trakt: 2 },
					user: { ids: { slug: 'friend' } },
				},
			},
		]);
		fetchListItemsMock.mockImplementation(
			async (_token: string, slug: string, traktId: number) => {
				if (traktId === 1) {
					return [{ movie: { ids: { imdb: 'tt123' }, title: 'Favorite Movie' } }];
				}
				return [{ show: { ids: { imdb: 'tt999' }, title: `${slug} Show` } }];
			}
		);

		render(<TraktMyListsPage />);

		await waitFor(() => expect(fetchListItemsMock).toHaveBeenCalledTimes(2));
		expect(screen.getByRole('option', { name: 'Community Picks' })).toBeInTheDocument();

		const select = screen.getByRole('combobox');
		fireEvent.change(select, { target: { value: 'Community Picks' } });

		await waitFor(() => expect(screen.getByText('tt999:friend Show')).toBeInTheDocument());
		fireEvent.change(select, { target: { value: 'Favorites' } });
		await waitFor(() => expect(screen.getByText('tt123:Favorite Movie')).toBeInTheDocument());
	});
});
