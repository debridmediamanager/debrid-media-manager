import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sponsorMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useSponsor', () => ({
	useSponsor: () => sponsorMock(),
	sponsorHeaders: () => ({ 'x-dmm-sponsor': 'token' }),
}));
vi.mock('next/head', () => ({
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
	default: ({ href, children, ...rest }: any) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

import WantedPage from '@/pages/wanted';

const film = {
	id: 'a',
	imdbId: 'tt0133093',
	kind: 'movie',
	title: 'The Matrix',
	seasons: null,
	createdAt: '2026-10-24T10:00:00Z',
	fulfilledAt: null,
	fulfilled: null,
	lastPolledAt: null,
};

/** Added an hour ago: a list in its first day, which gets no warning yet. */
const fresh = { ...film, createdAt: new Date(Date.now() - 3_600_000).toISOString() };

/** `/api/wanted/lists`: the Trakt and MDBList lists followed, none unless given. */
const listsAnswer = (lists: unknown[] = []) => new Response(JSON.stringify({ lists }));

describe('/wanted', () => {
	beforeEach(() => sponsorMock.mockReturnValue({ isSponsor: true }));
	afterEach(() => vi.restoreAllMocks());

	it('tells a non-sponsor how to get the list, without asking for it', () => {
		sponsorMock.mockReturnValue({ isSponsor: false });
		global.fetch = vi.fn() as any;
		render(<WantedPage />);
		expect(screen.getByText(/The wanted list is for sponsors/)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
		expect(global.fetch).not.toHaveBeenCalled();
	});

	// A list zurg has never read means zurg is not set up yet, which is the thing to fix.
	it('says how to point zurg at the list when zurg never read it', async () => {
		global.fetch = vi.fn(async (url: string) =>
			url === '/api/wanted/lists'
				? listsAnswer()
				: new Response(JSON.stringify({ items: [fresh] }))
		) as any;
		render(<WantedPage />);
		expect(await screen.findByText('The Matrix')).toBeInTheDocument();
		expect(screen.getByText(/has not read this list yet/)).toBeInTheDocument();
		expect(screen.getByText('dmm_api_key')).toBeInTheDocument();
	});

	it('shows when zurg last read it and what it fetched', async () => {
		global.fetch = vi.fn(async (url: string) =>
			url === '/api/wanted/lists'
				? listsAnswer()
				: new Response(
						JSON.stringify({
							items: [
								{
									...fresh,
									fulfilledAt: '2026-10-24T11:00:00Z',
									lastPolledAt: new Date(Date.now() - 60_000).toISOString(),
								},
							],
						})
					)
		) as any;
		render(<WantedPage />);
		expect(await screen.findByText(/^fetched /)).toBeInTheDocument();
		expect(screen.getByText(/^zurg read it /)).toBeInTheDocument();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	// A day with no zurg reading it: nothing is being fetched, and the guide says
	// how to change that.
	it('warns, with the guide, once the list has gone a day unread', async () => {
		global.fetch = vi.fn(async (url: string) =>
			url === '/api/wanted/lists'
				? listsAnswer()
				: new Response(JSON.stringify({ items: [film] }))
		) as any;
		render(<WantedPage />);
		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent(/nothing on this list is being fetched/i);
		expect(alert).toHaveTextContent(/no zurg has read it yet/i);
		expect(
			screen.getByRole('link', { name: /set up zurg for your wanted list/i })
		).toHaveAttribute('href', 'https://notes.debridmediamanager.com/zurg/guides/dmm-wanted/');
	});

	it('names the release zurg took and the resolution it still waits for', async () => {
		const release = 'The.Matrix.1999.1080p.BluRay.x264-GRP';
		global.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						items: [
							{
								...film,
								fulfilledAt: '2026-10-24T11:00:00Z',
								fulfilled: {
									release,
									grab: 'c'.repeat(40),
									torrent: true,
									resolution: '1080p',
									upgradeTo: '2160p',
								},
							},
						],
					})
				)
		) as any;
		render(<WantedPage />);
		const line = await screen.findByText(/^fetched .* · waiting for 2160p$/);
		expect(line.getAttribute('title')).toContain(release);
	});

	it('removes a title', async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
			init?.method === 'DELETE'
				? new Response(JSON.stringify({ ok: true }))
				: url === '/api/wanted/lists'
					? listsAnswer()
					: new Response(JSON.stringify({ items: [film] }))
		);
		global.fetch = fetchMock as any;
		render(<WantedPage />);
		fireEvent.click(await screen.findByRole('button', { name: 'Remove The Matrix' }));
		await waitFor(() => expect(screen.queryByText('The Matrix')).not.toBeInTheDocument());
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/wanted?imdbId=tt0133093',
			expect.objectContaining({ method: 'DELETE' })
		);
	});

	describe('with several films', () => {
		const films = [
			film,
			{
				...film,
				id: 'b',
				imdbId: 'tt0076759',
				title: 'Star Wars',
				createdAt: '2026-10-22T10:00:00Z',
				fulfilledAt: '2026-10-23T10:00:00Z',
			},
			{
				...film,
				id: 'c',
				imdbId: 'tt0088763',
				title: 'Back to the Future',
				createdAt: '2026-10-26T10:00:00Z',
			},
		];
		const titles = () =>
			screen
				.getAllByRole('checkbox', { name: /^Select (?!all)/ })
				.map((box) => box.getAttribute('aria-label')!.slice('Select '.length));
		let fetchMock: ReturnType<typeof vi.fn>;
		beforeEach(() => {
			fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
				init?.method === 'DELETE'
					? new Response(JSON.stringify({ ok: true, removed: 2 }))
					: url === '/api/wanted/lists'
						? listsAnswer()
						: new Response(JSON.stringify({ items: films }))
			);
			global.fetch = fetchMock as any;
		});

		it('searches, filters by status and sorts', async () => {
			render(<WantedPage />);
			await screen.findByText('Star Wars');
			expect(titles()).toEqual(['Back to the Future', 'The Matrix', 'Star Wars']);

			fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), {
				target: { value: 'title' },
			});
			expect(titles()).toEqual(['Back to the Future', 'Star Wars', 'The Matrix']);

			fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), {
				target: { value: 'waiting' },
			});
			expect(titles()).toEqual(['Back to the Future', 'The Matrix']);

			fireEvent.change(screen.getByRole('searchbox', { name: 'Search titles' }), {
				target: { value: 'matrix' },
			});
			expect(titles()).toEqual(['The Matrix']);

			fireEvent.change(screen.getByRole('searchbox', { name: 'Search titles' }), {
				target: { value: 'nope' },
			});
			expect(screen.getByText('Nothing matches.')).toBeInTheDocument();
		});

		it('removes the selected titles in one call', async () => {
			vi.spyOn(window, 'confirm').mockReturnValue(true);
			render(<WantedPage />);
			fireEvent.click(await screen.findByRole('checkbox', { name: 'Select The Matrix' }));
			fireEvent.click(screen.getByRole('checkbox', { name: 'Select Star Wars' }));
			fireEvent.click(screen.getByRole('button', { name: 'Remove 2 selected' }));
			await waitFor(() => expect(screen.queryByText('Star Wars')).not.toBeInTheDocument());
			expect(screen.queryByText('The Matrix')).not.toBeInTheDocument();
			expect(screen.getByText('Back to the Future')).toBeInTheDocument();
			const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')!;
			expect(JSON.parse(init.body)).toEqual({ imdbIds: ['tt0133093', 'tt0076759'] });
		});

		// Selecting all and then narrowing the search must not remove titles out of sight.
		it('removes only the selected titles still shown', async () => {
			vi.spyOn(window, 'confirm').mockReturnValue(true);
			render(<WantedPage />);
			fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all 3' }));
			fireEvent.change(screen.getByRole('searchbox', { name: 'Search titles' }), {
				target: { value: 'star' },
			});
			fireEvent.click(screen.getByRole('button', { name: 'Remove 1 selected' }));
			await waitFor(() => expect(screen.queryByText('Star Wars')).not.toBeInTheDocument());
			const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')!;
			expect(JSON.parse(init.body)).toEqual({ imdbIds: ['tt0076759'] });
		});

		it('keeps everything when the removal is not confirmed', async () => {
			vi.spyOn(window, 'confirm').mockReturnValue(false);
			render(<WantedPage />);
			fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all 3' }));
			fireEvent.click(screen.getByRole('button', { name: 'Remove 3 selected' }));
			expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
			expect(screen.getByText('Star Wars')).toBeInTheDocument();
		});
	});

	it('follows a pasted list and shows what that added, then the list among those followed', async () => {
		const followed = {
			id: 'list-1',
			url: 'https://trakt.tv/users/giladg/lists/latest-4k-releases',
			name: 'Latest 4K Releases',
			count: 272,
			added: 240,
			createdAt: '2026-10-29T10:00:00Z',
			syncedAt: '2026-10-29T10:00:05Z',
			error: null,
		};
		let lists: unknown[] = [];
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (url === '/api/wanted/lists' && init?.method === 'POST') {
				lists = [followed];
				return new Response(
					JSON.stringify({
						name: followed.name,
						count: 272,
						added: 240,
						alreadyWanted: 12,
						overCap: 0,
						noImdbId: 20,
						list: followed,
					})
				);
			}
			if (url === '/api/wanted/lists') return listsAnswer(lists);
			return new Response(JSON.stringify({ items: [film] }));
		});
		global.fetch = fetchMock as any;
		render(<WantedPage />);
		await screen.findByText('The Matrix');
		fireEvent.change(screen.getByRole('textbox', { name: 'List URL' }), {
			target: { value: 'https://trakt.tv/users/giladg/lists/latest-4k-releases' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
		expect(
			await screen.findByText(
				'Following Latest 4K Releases (272 titles): 240 added, 12 already wanted. 20 left out for having no IMDb id.'
			)
		).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/wanted/lists',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					url: 'https://trakt.tv/users/giladg/lists/latest-4k-releases',
				}),
			})
		);
		expect(screen.getByRole('link', { name: 'Latest 4K Releases' })).toHaveAttribute(
			'href',
			followed.url
		);
		expect(
			screen.getByRole('link', { name: 'Latest 4K Releases' }).parentElement?.textContent
		).toMatch(/272 titles · 240 added so far · read /);
		expect(
			screen.getByRole('button', { name: 'Unfollow Latest 4K Releases' })
		).toBeInTheDocument();
	});
});
