import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/withAuth', () => ({
	withAuth: (component: any) => component,
}));

const localStorageMock = vi.hoisted(() =>
	vi.fn((key: string) => [key.includes('accessToken') ? 'list-token' : 'user-slug'])
);

vi.mock('@/hooks/localStorage', () => ({
	default: localStorageMock,
}));

vi.mock('@/components/poster', () => ({
	default: ({ title }: { title: string }) => <div>{title}</div>,
}));

const routerMock = {
	query: { listName: encodeURIComponent('Favorites') },
};

vi.mock('next/router', () => ({
	useRouter: () => routerMock,
}));

const traktMocks = vi.hoisted(() => ({
	getUsersPersonalLists: vi.fn(),
	getLikedLists: vi.fn(),
	fetchListItems: vi.fn(),
}));

vi.mock('@/services/trakt', () => traktMocks);

vi.mock('next/head', () => ({
	default: ({ children }: any) => <>{children}</>,
}));

vi.mock('react-hot-toast', () => ({
	Toaster: () => null,
}));

import { clearCachedList } from '@/hooks/useCachedList';
import TraktMyLists from '@/pages/trakt/mylists/[listName]';

beforeEach(() => {
	clearCachedList();
	vi.clearAllMocks();
});

describe('TraktMyLists page', () => {
	it('renders entries from personal lists', async () => {
		traktMocks.getUsersPersonalLists.mockResolvedValue([
			{ name: 'Favorites', ids: { trakt: 10 } },
		]);
		traktMocks.getLikedLists.mockResolvedValue([]);
		traktMocks.fetchListItems.mockResolvedValue([
			{ movie: { ids: { imdb: 'tt10' }, title: 'Personal Entry' } },
		]);

		render(<TraktMyLists />);

		await waitFor(() =>
			expect(traktMocks.fetchListItems).toHaveBeenCalledWith('list-token', 'user-slug', 10)
		);
		expect(screen.getByText('Personal Entry')).toBeInTheDocument();
	});

	it('renders liked list entries when personal list is absent', async () => {
		traktMocks.getUsersPersonalLists.mockResolvedValue([]);
		traktMocks.getLikedLists.mockResolvedValue([
			{
				list: { name: 'Favorites', ids: { trakt: 11 }, user: { ids: { slug: 'ally' } } },
			},
		]);
		traktMocks.fetchListItems.mockResolvedValue([
			{ show: { ids: { imdb: 'tt11' }, title: 'Liked Entry' } },
		]);

		render(<TraktMyLists />);

		await waitFor(() =>
			expect(traktMocks.fetchListItems).toHaveBeenCalledWith('list-token', 'ally', 11)
		);
		expect(screen.getByText('Liked Entry')).toBeInTheDocument();
	});
});
