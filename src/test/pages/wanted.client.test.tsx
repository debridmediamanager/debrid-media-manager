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
				: new Response(JSON.stringify({ items: [film] }))
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
									...film,
									fulfilledAt: '2026-10-24T11:00:00Z',
									lastPolledAt: '2026-10-24T11:05:00Z',
								},
							],
						})
					)
		) as any;
		render(<WantedPage />);
		expect(await screen.findByText(/^fetched /)).toBeInTheDocument();
		expect(screen.getByText(/^zurg read it /)).toBeInTheDocument();
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
