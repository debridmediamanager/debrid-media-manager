import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WantedButton from './WantedButton';

const sponsorMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useSponsor', () => ({
	useSponsor: () => sponsorMock(),
	sponsorHeaders: () => ({ 'x-dmm-sponsor': 'token' }),
}));
vi.mock('next/link', () => ({
	default: ({ href, children, ...rest }: any) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const SHOW = 'tt0115082';
const stored = (seasons: number[] | null) => ({
	id: 'x',
	imdbId: SHOW,
	kind: 'show',
	title: '3rd Rock',
	seasons,
	createdAt: '2026-10-24T10:00:00Z',
	fulfilledAt: null,
	lastPolledAt: null,
});

function mockFetch(listed: unknown[]) {
	const calls: { url: string; init?: RequestInit }[] = [];
	global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		if (!init?.method) return new Response(JSON.stringify({ items: listed }));
		if (init.method === 'POST') {
			const body = JSON.parse(init.body as string);
			return new Response(JSON.stringify({ item: stored(body.seasons) }));
		}
		return new Response(JSON.stringify({ ok: true }));
	}) as any;
	return calls;
}

const posted = (calls: { init?: RequestInit }[]) =>
	calls.filter((c) => c.init?.method === 'POST').map((c) => JSON.parse(c.init!.body as string));

describe('WantedButton', () => {
	beforeEach(() => sponsorMock.mockReturnValue({ isSponsor: true }));
	afterEach(() => vi.restoreAllMocks());

	// Wanting season 3 must not drop the seasons already wanted.
	it("adds a season beside the show's other wanted seasons", async () => {
		const calls = mockFetch([stored([1])]);
		render(<WantedButton imdbId={SHOW} kind="show" title="3rd Rock" season={3} />);
		const button = await screen.findByRole('button', { name: /Want S3/ });
		fireEvent.click(button);
		await screen.findByRole('button', { name: /Wanted: S3/ });
		expect(posted(calls)).toEqual([
			{ imdbId: SHOW, kind: 'show', title: '3rd Rock', seasons: [1, 3] },
		]);
	});

	it('takes one season off and keeps the rest', async () => {
		const calls = mockFetch([stored([1, 3])]);
		render(<WantedButton imdbId={SHOW} kind="show" title="3rd Rock" season={3} />);
		fireEvent.click(await screen.findByRole('button', { name: /Wanted: S3/ }));
		await screen.findByRole('button', { name: /Want S3/ });
		expect(posted(calls)[0].seasons).toEqual([1]);
	});

	it('removes the show when its last wanted season is taken off', async () => {
		const calls = mockFetch([stored([3])]);
		render(<WantedButton imdbId={SHOW} kind="show" title="3rd Rock" season={3} />);
		fireEvent.click(await screen.findByRole('button', { name: /Wanted: S3/ }));
		await waitFor(() => expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true));
		expect(calls.find((c) => c.init?.method === 'DELETE')!.url).toBe(
			`/api/wanted?imdbId=${SHOW}`
		);
	});

	// With every season wanted there is no season list to take one out of.
	it('leaves a season button inert when every season is wanted', async () => {
		mockFetch([stored(null)]);
		render(<WantedButton imdbId={SHOW} kind="show" title="3rd Rock" season={3} />);
		await waitFor(() =>
			expect(screen.getByRole('button', { name: /Wanted: S3/ })).toBeDisabled()
		);
	});

	it('wants every season from the whole-show button', async () => {
		const calls = mockFetch([stored([1])]);
		render(<WantedButton imdbId={SHOW} kind="show" title="3rd Rock" />);
		fireEvent.click(await screen.findByRole('button', { name: /Want all seasons/ }));
		await screen.findByRole('button', { name: /Wanted: all seasons/ });
		expect(posted(calls)[0].seasons).toBeNull();
	});

	it('sends a non-sponsor to the page that explains the list', () => {
		sponsorMock.mockReturnValue({ isSponsor: false });
		global.fetch = vi.fn() as any;
		render(<WantedButton imdbId="tt0133093" kind="movie" title="The Matrix" />);
		expect(screen.getByRole('link', { name: /Want/ })).toHaveAttribute('href', '/wanted');
		expect(global.fetch).not.toHaveBeenCalled();
	});

	// An inline <a> around the flex label splits its border into empty fragments with
	// the label on a line of its own (Discord report, 2026-10-25). jsdom has no layout,
	// so this pins the class that keeps the link one box.
	it("keeps the non-sponsor link one box like the page's buttons", () => {
		sponsorMock.mockReturnValue({ isSponsor: false });
		global.fetch = vi.fn() as any;
		render(<WantedButton imdbId={SHOW} kind="show" title="3rd Rock" />);
		expect(screen.getByRole('link', { name: /Want/ })).toHaveClass('inline-block');
	});

	// Both of a season page's buttons led a non-sponsor to /wanted; one says it.
	it('gives a non-sponsor one Want link on a season page', () => {
		sponsorMock.mockReturnValue({ isSponsor: false });
		global.fetch = vi.fn() as any;
		render(
			<>
				<WantedButton imdbId={SHOW} kind="show" title="3rd Rock" season={1} />
				<WantedButton imdbId={SHOW} kind="show" title="3rd Rock" />
			</>
		);
		const links = screen.getAllByRole('link');
		expect(links).toHaveLength(1);
		expect(links[0]).toHaveTextContent(/^Want$/);
		expect(links[0]).toHaveAttribute('href', '/wanted');
	});
});
