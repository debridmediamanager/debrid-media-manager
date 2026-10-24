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
	lastPolledAt: null,
};

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
		global.fetch = vi.fn(async () => new Response(JSON.stringify({ items: [film] }))) as any;
		render(<WantedPage />);
		expect(await screen.findByText('The Matrix')).toBeInTheDocument();
		expect(screen.getByText(/has not read this list yet/)).toBeInTheDocument();
		expect(screen.getByText('dmm_api_key')).toBeInTheDocument();
	});

	it('shows when zurg last read it and what it fetched', async () => {
		global.fetch = vi.fn(
			async () =>
				new Response(
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
		expect(await screen.findByText(/zurg fetched it/)).toBeInTheDocument();
		expect(screen.getByText(/Your zurg last read this list/)).toBeInTheDocument();
	});

	it('removes a title', async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
			init?.method === 'DELETE'
				? new Response(JSON.stringify({ ok: true }))
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
});
