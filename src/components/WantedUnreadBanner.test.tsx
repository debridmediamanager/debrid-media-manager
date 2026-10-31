import { WANTED_GUIDE_URL } from '@/utils/wantedUnread';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WANTED_UNREAD_DISMISS_KEY, WantedUnreadBanner } from './WantedUnreadBanner';

const sponsor = vi.hoisted(() => ({ isSponsor: true }));
vi.mock('@/hooks/useSponsor', () => ({
	useSponsor: () => sponsor,
	sponsorHeaders: () => ({ 'x-dmm-sponsor': 't' }),
}));

const day = 24 * 60 * 60 * 1000;
const answer = (summary: object) =>
	vi
		.spyOn(global, 'fetch')
		.mockImplementation(async () => new Response(JSON.stringify(summary), { status: 200 }));

describe('WantedUnreadBanner', () => {
	beforeEach(() => {
		window.localStorage.clear();
		sponsor.isSponsor = true;
	});
	afterEach(() => vi.restoreAllMocks());

	it('links the guide once a list has gone a day with no zurg reading it', async () => {
		answer({
			count: 1800,
			since: new Date(Date.now() - 4 * day).toISOString(),
			lastPolledAt: null,
		});
		render(<WantedUnreadBanner />);
		const guide = await screen.findByRole('link', { name: /set up zurg/i });
		expect(guide.getAttribute('href')).toBe(WANTED_GUIDE_URL);
		expect(guide.getAttribute('target')).toBe('_blank');
		expect(screen.getByText(/no zurg has read your wanted list yet/i)).toBeInTheDocument();
	});

	it('says nothing while a zurg reads the list', async () => {
		const fetched = answer({
			count: 1273,
			since: new Date(Date.now() - 6 * day).toISOString(),
			lastPolledAt: new Date(Date.now() - 60_000).toISOString(),
		});
		render(<WantedUnreadBanner />);
		await waitFor(() => expect(fetched).toHaveBeenCalled());
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('asks nothing for a visitor who is not a sponsor', () => {
		sponsor.isSponsor = false;
		const fetched = vi.spyOn(global, 'fetch');
		render(<WantedUnreadBanner />);
		expect(fetched).not.toHaveBeenCalled();
	});

	it('stays away for a week once dismissed', async () => {
		const user = userEvent.setup();
		answer({
			count: 5,
			since: new Date(Date.now() - 4 * day).toISOString(),
			lastPolledAt: null,
		});
		const { unmount } = render(<WantedUnreadBanner />);
		await user.click(await screen.findByRole('button', { name: /dismiss/i }));
		expect(screen.queryByRole('alert')).toBeNull();
		unmount();
		render(<WantedUnreadBanner />);
		await new Promise((r) => setTimeout(r, 20));
		expect(screen.queryByRole('alert')).toBeNull();

		window.localStorage.setItem(WANTED_UNREAD_DISMISS_KEY, String(Date.now() - 8 * day));
		render(<WantedUnreadBanner />);
		expect(await screen.findByRole('alert')).toBeInTheDocument();
	});
});
