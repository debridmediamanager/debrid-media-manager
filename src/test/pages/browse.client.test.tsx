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
	default: ({ href, children, title }: any) => (
		<a href={href} title={title}>
			{children}
		</a>
	),
}));

// `/api/anime/by-imdb` runs for real over production's anime data.
vi.mock('@/services/repository', async () => ({
	repository: {
		getAnimeEntryRows: (await import('@/test/utils/animeFixtures')).fixtureAnimeEntryRows,
	},
}));
vi.mock('@/services/anime/animeFranchise', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/anime/animeFranchise')>();
	const f = await import('@/test/utils/animeFixtures');
	return {
		...actual,
		getFranchiseIndex: async () => actual.buildFranchiseIndex(f.fixtureFribbEntries()),
	};
});
vi.mock('@/services/anime/kitsuLabels', async () => ({
	getKitsuLabel: (await import('@/test/utils/animeFixtures')).fixtureKitsuLabel,
}));

import { clearAnimeEntriesCache } from '@/hooks/useAnimeEntries';
import { clearCachedList } from '@/hooks/useCachedList';
import byImdbRoute from '@/pages/api/anime/by-imdb';
import { Browse } from '@/pages/browse/[search]';
import { animeFixture, callAnimeRoute } from '@/test/utils/animeFixtures';

describe('Browse page', () => {
	beforeEach(() => {
		clearCachedList();
		clearAnimeEntriesCache();
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

	// Production's /browse/anime answer on 2026-09-27: MDBList items keyed by
	// IMDb id. Frieren, Apothecary and Bookworm are each several AniDB entries.
	it('links anime titles to their AniDB entries under each poster', async () => {
		routerMock.query = { search: 'anime' };
		fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/info/browse?search=anime') {
				return { ok: true, json: async () => animeFixture('api-info-browse-anime.json') };
			}
			if (url.startsWith('/api/anime/by-imdb')) {
				const { status, data } = await callAnimeRoute(byImdbRoute, url);
				return { ok: status === 200, status, json: async () => data };
			}
			throw new Error(`unexpected ${url}`);
		});

		render(<Browse />);

		await waitFor(() => expect(screen.getAllByTestId('anime-entry-links')).toHaveLength(3));
		const byImdb = fetchMock.mock.calls.map(([u]) => u).filter((u) => u.includes('by-imdb'));
		// One request for every distinct title on the page.
		const lists = animeFixture<Record<string, string[]>>('api-info-browse-anime.json');
		const distinct = new Set(
			Object.values(lists)
				.flat()
				.map((k) => k.split(':')[1])
		);
		expect(byImdb).toHaveLength(1);
		expect(new Set(byImdb[0].split('imdbids=')[1].split(','))).toEqual(distinct);

		const frieren = screen.getByRole('link', { name: /Sousou no Frieren 2nd Season/ });
		expect(frieren).toHaveAttribute('href', '/anime/18886');
		expect(frieren).toHaveAttribute('title', 'Sousou no Frieren 2nd Season (TV)');
		// Bookworm is five entries; a poster shows three and counts the rest.
		const bookworm = screen
			.getAllByTestId('anime-entry-links')
			.find((el) => el.textContent?.includes('Honzuki'))!;
		expect(bookworm.querySelectorAll('a[href^="/anime/"]')).toHaveLength(4);
		expect(bookworm).toHaveTextContent('+2 more');
	});

	// 12 of the 96 were dropped: every title with a colon in it.
	it('renders every item production listed, titles with colons included', async () => {
		routerMock.query = { search: 'anime' };
		const lists = animeFixture<Record<string, string[]>>('api-info-browse-anime.json');
		fetchMock.mockImplementation(async (url: string) =>
			url.startsWith('/api/info/browse')
				? { ok: true, json: async () => lists }
				: { ok: true, json: async () => ({ results: {} }) }
		);

		render(<Browse />);

		await waitFor(() => expect(screen.getAllByTestId('poster')).toHaveLength(96));
		expect(screen.getByText("tt22248376:Frieren: Beyond Journey's End")).toBeInTheDocument();
		expect(
			screen.getByText('tt1355642:Fullmetal Alchemist: Brotherhood').closest('a')
		).toHaveAttribute('href', '/show/tt1355642');
		expect(
			screen.getByText('tt5607616:Re:ZERO -Starting Life in Another World-')
		).toBeInTheDocument();
	});

	it('asks for no AniDB entries on lists that are not anime', async () => {
		routerMock.query = { search: 'matrix' };
		fetchMock.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ 'Neo Picks': ['movie:tt0133093:The Matrix'] }),
		});

		render(<Browse />);

		await waitFor(() => expect(screen.getByText('tt0133093:The Matrix')).toBeInTheDocument());
		expect(fetchMock.mock.calls.some(([u]) => String(u).includes('by-imdb'))).toBe(false);
	});
});
