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
				isLoading={false}
			/>
		);

		const castLink = screen.getByRole('link', { name: /cast for pm/i });
		expect(castLink.getAttribute('href')).toBe('/stremio-premiumize');
	});

	it('shows both RD and TB cast actions when both users are authenticated', () => {
		render(
			<MainActions
				rdUser={baseRdUser}
				tbUser={baseTbUser}
				adUser={false}
				pmUser={false}
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
				isLoading={false}
			/>
		);

		expect(screen.getByRole('link', { name: /transfers/i }).getAttribute('href')).toBe(
			'/transfers'
		);
	});

	it('hides Transfers without Real-Debrid, since every transfer lands there', () => {
		render(
			<MainActions
				rdUser={null}
				tbUser={baseTbUser}
				adUser={false}
				pmUser={false}
				isLoading={false}
			/>
		);

		expect(screen.queryByRole('link', { name: /transfers/i })).toBeNull();
	});
});
