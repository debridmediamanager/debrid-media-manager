import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('next/router', () => ({
	useRouter: () => {
		const [search, setSearch] = React.useState(window.location.search);
		React.useEffect(() => {
			const update = () => setSearch(window.location.search);
			window.addEventListener('popstate', update);
			return () => window.removeEventListener('popstate', update);
		}, []);
		return {
			pathname: '/trakt/mylists',
			query: Object.fromEntries(new URLSearchParams(search)),
			replace: async ({
				pathname,
				query,
			}: {
				pathname: string;
				query: Record<string, string>;
			}) => {
				const params = new URLSearchParams(query).toString();
				window.history.replaceState(null, '', `${pathname}${params ? `?${params}` : ''}`);
				window.dispatchEvent(new PopStateEvent('popstate'));
				return true;
			},
		};
	},
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
	default: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a
			href={href}
			onClick={(event) => {
				event.preventDefault();
				window.history.pushState(null, '', href);
			}}
		>
			{children}
		</a>
	),
}));

import { clearCachedList } from '@/hooks/useCachedList';
import TraktMyListsPage from '@/pages/trakt/mylists';

describe('TraktMyLists page', () => {
	beforeEach(() => {
		clearCachedList();
		window.history.replaceState(null, '', '/trakt/mylists');
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

	it('returns from a title to the selected list, including punctuation in its name', async () => {
		const listName = 'Sci-fi / 100% & favorites';
		storedValues.set('trakt:accessToken', 'token123');
		storedValues.set('trakt:userSlug', 'user-slug');
		personalListsMock.mockResolvedValue([{ name: listName, ids: { trakt: 1 } }]);
		likedListsMock.mockResolvedValue([]);
		fetchListItemsMock.mockResolvedValue([
			{ movie: { ids: { imdb: 'tt1160419' }, title: 'Dune' } },
		]);

		const page = render(<TraktMyListsPage />);
		await screen.findByRole('option', { name: listName });
		fireEvent.change(screen.getByRole('combobox'), { target: { value: listName } });
		const title = await screen.findByRole('link', { name: 'tt1160419:Dune' });
		fireEvent.click(title);
		page.unmount();
		expect(window.location.pathname).toBe('/movie/tt1160419');

		window.history.back();
		await waitFor(() => expect(window.location.pathname).toBe('/trakt/mylists'));
		render(<TraktMyListsPage />);

		expect(screen.getByRole('combobox')).toHaveValue(listName);
		expect(await screen.findByRole('link', { name: 'tt1160419:Dune' })).toBeInTheDocument();
		expect(
			screen.queryByText('Please select a list to view its contents')
		).not.toBeInTheDocument();
	});

	it('clears the routed selection when returning to the list picker', async () => {
		storedValues.set('trakt:accessToken', 'token123');
		storedValues.set('trakt:userSlug', 'user-slug');
		personalListsMock.mockResolvedValue([{ name: 'Favorites', ids: { trakt: 1 } }]);
		likedListsMock.mockResolvedValue([]);
		fetchListItemsMock.mockResolvedValue([]);
		window.history.replaceState(null, '', '/trakt/mylists?list=Favorites');

		const page = render(<TraktMyListsPage />);
		await screen.findByRole('option', { name: 'Favorites' });
		fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
		page.unmount();
		render(<TraktMyListsPage />);

		expect(screen.getByRole('combobox')).toHaveValue('');
		expect(screen.getByText('Please select a list to view its contents')).toBeInTheDocument();
	});

	it.each(['constructor', 'toString', '__proto__'])(
		'waits for an own list named %s rather than treating an inherited property as items',
		async (listName) => {
			storedValues.set('trakt:accessToken', 'token123');
			storedValues.set('trakt:userSlug', 'user-slug');
			const lists = Promise.withResolvers<Array<{ name: string; ids: { trakt: number } }>>();
			personalListsMock.mockReturnValue(lists.promise);
			likedListsMock.mockResolvedValue([]);
			fetchListItemsMock.mockResolvedValue([
				{ movie: { ids: { imdb: 'tt1160419' }, title: 'Dune' } },
			]);
			window.history.replaceState(
				null,
				'',
				`/trakt/mylists?list=${encodeURIComponent(listName)}`
			);

			render(<TraktMyListsPage />);
			expect(screen.queryByRole('link', { name: 'tt1160419:Dune' })).toBeNull();
			await act(async () => lists.resolve([{ name: listName, ids: { trakt: 1 } }]));

			expect(await screen.findByRole('link', { name: 'tt1160419:Dune' })).toBeInTheDocument();
			expect(screen.getByRole('combobox')).toHaveValue(listName);
		}
	);
});
