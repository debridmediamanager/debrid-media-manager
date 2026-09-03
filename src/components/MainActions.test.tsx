import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MainActions } from './MainActions';

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

describe('MainActions', () => {
	const baseRdUser = {
		id: 1,
		username: 'tester',
		email: 'tester@example.com',
		points: 0,
		locale: 'en',
		avatar: '',
		type: 'premium' as const,
		premium: 1,
		expiration: '2099-01-01',
	};

	const baseTbUser = {
		id: 1,
		created_at: '2024-01-01T00:00:00Z',
		updated_at: '2024-01-01T00:00:00Z',
		email: 'tester@example.com',
		plan: 1,
		total_downloaded: 0,
		customer: 'cus_123',
		server: 1,
		is_subscribed: true,
		premium_expires_at: '2099-01-01',
		cooldown_until: '',
		auth_id: 'auth_123',
		user_referral: 'ref_123',
		base_email: 'tester@example.com',
	};

	it('always renders library and hash list links', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		const libraryLink = screen.getByRole('link', { name: /library/i });
		expect(libraryLink.getAttribute('href')).toBe('/library');

		const hashListLink = screen.getByRole('link', { name: /hash lists/i });
		expect(hashListLink.getAttribute('href')).toBe('https://hashlists.debridmediamanager.com');
		expect(hashListLink.getAttribute('target')).toBe('_blank');
	});

	it('shows RD cast action when only RD user is authenticated', () => {
		render(
			<MainActions
				rdUser={baseRdUser}
				tbUser={null}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		const castLink = screen.getByRole('link', { name: /cast for rd/i });
		expect(castLink.getAttribute('href')).toBe('/stremio');
	});

	it('shows TB cast action when only TB user is authenticated', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={baseTbUser}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		const castLink = screen.getByRole('link', { name: /cast for tb/i });
		expect(castLink.getAttribute('href')).toBe('/stremio-torbox');
	});

	it('shows AD cast action when only AD user is authenticated', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser={true}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		const castLink = screen.getByRole('link', { name: /cast for ad/i });
		expect(castLink.getAttribute('href')).toBe('/stremio-alldebrid');
	});

	it('shows PM cast action when only PM user is authenticated', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser={false}
				pmUser={true}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		const castLink = screen.getByRole('link', { name: /cast for pm/i });
		expect(castLink.getAttribute('href')).toBe('/stremio-premiumize');
	});

	it('shows OC cast action when only OC user is authenticated', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser={false}
				pmUser={false}
				ocUser={true}
				dlUser={false}
				isLoading={false}
			/>
		);

		const castLink = screen.getByRole('link', { name: /cast for oc/i });
		expect(castLink.getAttribute('href')).toBe('/stremio-offcloud');
	});

	// Five buttons used to fall through to `grid-cols-4`, wrapping the fifth
	// alone into a quarter-width cell. Past four they wrap onto a second line
	// instead: 3+2 for five, 3+3 for six.
	it.each([
		[{ pmUser: false, ocUser: false, dlUser: false }, 'grid-cols-3'],
		[{ pmUser: true, ocUser: false, dlUser: false }, 'grid-cols-4'],
		[{ pmUser: true, ocUser: true, dlUser: false }, 'grid-cols-3'],
		[{ pmUser: true, ocUser: true, dlUser: true }, 'grid-cols-3'],
	])('lays the cast row out as %o -> %s', (flags, expected) => {
		const { container } = render(
			<MainActions
				rdUser={baseRdUser}
				tbUser={baseTbUser}
				adUser={true}
				pmUser={flags.pmUser}
				ocUser={flags.ocUser}
				dlUser={flags.dlUser}
				isLoading={false}
			/>
		);

		const row = container.querySelector('a[href="/stremio"]')?.parentElement;
		expect(row?.className).toContain(expected);
	});

	it('shows both RD and TB cast actions when both users are authenticated', () => {
		render(
			<MainActions
				rdUser={baseRdUser}
				tbUser={baseTbUser}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		const rdLink = screen.getByRole('link', { name: /cast for rd/i });
		const tbLink = screen.getByRole('link', { name: /cast for tb/i });
		expect(rdLink.getAttribute('href')).toBe('/stremio');
		expect(tbLink.getAttribute('href')).toBe('/stremio-torbox');
	});

	it('shows all three cast actions when all users are authenticated', () => {
		render(
			<MainActions
				rdUser={baseRdUser}
				tbUser={baseTbUser}
				adUser={true}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		const rdLink = screen.getByRole('link', { name: /cast for rd/i });
		const tbLink = screen.getByRole('link', { name: /cast for tb/i });
		const adLink = screen.getByRole('link', { name: /cast for ad/i });
		expect(rdLink.getAttribute('href')).toBe('/stremio');
		expect(tbLink.getAttribute('href')).toBe('/stremio-torbox');
		expect(adLink.getAttribute('href')).toBe('/stremio-alldebrid');
	});

	it('hides cast actions when no user is authenticated', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		expect(screen.queryByRole('link', { name: /cast for/i })).toBeNull();
	});

	// Usenet → RD transfers need no TorBox account, so gating this link on
	// RD *and* TB hid the Transfers page from everyone who only has RD — including
	// the users the send toast tells to go and watch their job there.
	it('links to Transfers for an RD user with no TorBox account', () => {
		render(
			<MainActions
				rdUser={baseRdUser}
				tbUser={null}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		const link = screen.getByRole('link', { name: /transfers/i });
		expect(link.getAttribute('href')).toBe('/transfers');
	});

	it('still links to Transfers when both RD and TB are connected', () => {
		render(
			<MainActions
				rdUser={baseRdUser}
				tbUser={baseTbUser}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		expect(screen.getByRole('link', { name: /transfers/i }).getAttribute('href')).toBe(
			'/transfers'
		);
	});

	it('links to the request board for a fulfiller — a TorBox, AllDebrid or Premiumize user', () => {
		// A user with no Real-Debrid at all, only TorBox: they are exactly who the
		// board is for, so the link is theirs even though Transfers is not.
		render(
			<MainActions
				rdUser={null}
				tbUser={baseTbUser}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		expect(screen.getByRole('link', { name: /requests/i }).getAttribute('href')).toBe(
			'/requests'
		);
		expect(screen.queryByRole('link', { name: /transfers/i })).toBeNull();
	});

	it('shows the request board to an AllDebrid user', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);
		expect(screen.getByRole('link', { name: /requests/i })).not.toBeNull();
	});

	it('hides the request board from a Premiumize-only user, who has nothing to fulfil with', () => {
		// The uploader cannot source a transfer from Premiumize, so a Premiumize
		// user is not sent to the board at all.
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser={false}
				pmUser
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);
		expect(screen.queryByRole('link', { name: /requests/i })).toBeNull();
	});

	it('hides the request board from an Offcloud-only user, who has nothing to fulfil with', () => {
		// Offcloud reaches this component only to draw its cast button. Like
		// Premiumize, the uploader cannot source a transfer from it, so the
		// board's row stays gated on rd/tb/ad and an Offcloud-only login never
		// sees it - while still getting its Cast link.
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser={false}
				pmUser={false}
				ocUser={true}
				dlUser={false}
				isLoading={false}
			/>
		);

		expect(screen.queryByRole('link', { name: /requests/i })).toBeNull();
		expect(screen.getByRole('link', { name: /cast for oc/i })).not.toBeNull();
	});

	it('shows DL cast action when only DL user is authenticated', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={true}
				isLoading={false}
			/>
		);

		const castLink = screen.getByRole('link', { name: /cast for dl/i });
		expect(castLink.getAttribute('href')).toBe('/stremio-debridlink');
	});

	it('hides the request board from a Debrid-Link-only user, who has nothing to fulfil with', () => {
		// Debrid-Link reaches this component only to draw its cast button. Like
		// Premiumize and Offcloud, the uploader cannot source a transfer from it.
		render(
			<MainActions
				rdUser={null}
				tbUser={null}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={true}
				isLoading={false}
			/>
		);

		expect(screen.queryByRole('link', { name: /requests/i })).toBeNull();
		expect(screen.getByRole('link', { name: /cast for dl/i })).not.toBeNull();
	});

	it('hides the request board from a Real-Debrid-only user, who asks from the search result instead', () => {
		render(
			<MainActions
				rdUser={baseRdUser}
				tbUser={null}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		expect(screen.queryByRole('link', { name: /requests/i })).toBeNull();
	});

	it('hides Transfers without Real-Debrid, since every transfer lands there', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={baseTbUser}
				adUser={false}
				pmUser={false}
				ocUser={false}
				dlUser={false}
				isLoading={false}
			/>
		);

		expect(screen.queryByRole('link', { name: /transfers/i })).toBeNull();
	});
});
