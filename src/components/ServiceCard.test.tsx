import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceCard } from './ServiceCard';

const modalControls = vi.hoisted(() => ({
	fireMock: vi.fn(),
	dismissReasons: { cancel: 'cancel' } as const,
}));

vi.mock('../components/modals/modal', () => ({
	__esModule: true,
	default: {
		fire: (...args: unknown[]) => modalControls.fireMock(...args),
		DismissReason: modalControls.dismissReasons,
	},
}));

const fireMock = modalControls.fireMock;
const dismissReasons = modalControls.dismissReasons;

const baseRdUser = {
	id: 1,
	username: 'rd-user',
	email: 'rd@example.com',
	points: 10,
	locale: 'en',
	avatar: '',
	type: 'premium',
	premium: 172800,
	expiration: new Date(Date.now() + 86400000).toISOString(),
} as any;

const baseAdUser = {
	username: 'ad-user',
	email: 'ad@example.com',
	isPremium: true,
	isSubscribed: true,
	isTrial: false,
	premiumUntil: Math.floor(Date.now() / 1000) + 86400,
	lang: 'en',
	preferedDomain: 'alldebrid.com',
	fidelityPoints: 12,
} as any;

const baseTbUser = {
	email: 'tb@example.com',
	created_at: new Date('2023-01-01').toISOString(),
	plan: 2,
	premium_expires_at: new Date(Date.now() + 86400000).toISOString(),
	total_downloaded: 5,
	cooldown_until: null,
	user_referral: 'ref123',
} as any;

const basePmUser = {
	customer_id: '100000002',
	premium_until: Math.floor(Date.now() / 1000) + 86400,
	limit_used: 0.0381,
	space_used: 276445467,
	booster_points: 0,
} as any;

const baseOcUser = {
	user_id: '100000001',
	email: 'oc-user@example.com',
	is_premium: true,
	expiration_date: '2026-10-02',
	can_download: true,
} as any;

const baseDlUser = {
	username: 'ymsita',
	email: 'p**d@deb*******k',
	emailVerified: true,
	accountType: 1,
	premiumLeft: 3628800,
	pts: 305,
} as any;

const baseTraktUser = {
	user: {
		username: 'trakt-user',
		private: false,
		vip: true,
		joined_at: new Date('2022-01-01').toISOString(),
	},
} as any;

beforeEach(() => {
	fireMock.mockReset();
});

describe('ServiceCard', () => {
	it('launches Real-Debrid details and confirms logout when requested', async () => {
		const onLogout = vi.fn();
		fireMock
			.mockResolvedValueOnce({ isDismissed: true, dismiss: dismissReasons.cancel })
			.mockResolvedValueOnce({ isConfirmed: true });

		render(
			<ServiceCard
				service="rd"
				user={baseRdUser}
				onTraktLogin={vi.fn()}
				onLogout={onLogout}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: /Real-Debrid/i }));

		await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
		expect(fireMock.mock.calls[0][0].title).toBe('Real-Debrid');
		expect(onLogout).toHaveBeenCalledWith('rd:');
	});

	it('shows AllDebrid, Torbox, and Trakt account shortcuts', () => {
		render(
			<div className="space-y-2">
				<ServiceCard
					service="ad"
					user={baseAdUser}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
				<ServiceCard
					service="tb"
					user={baseTbUser}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
				<ServiceCard
					service="trakt"
					user={baseTraktUser}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
			</div>
		);

		expect(screen.getByRole('button', { name: /AllDebrid/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Torbox/ })).toHaveTextContent('tb');
		expect(screen.getByRole('button', { name: /Trakt/ })).toHaveTextContent('trakt-user');
	});

	it('identifies Premiumize by customer id, the only identifier it exposes', () => {
		render(
			<ServiceCard service="pm" user={basePmUser} onTraktLogin={vi.fn()} onLogout={vi.fn()} />
		);

		expect(screen.getByRole('button', { name: /Premiumize/ })).toHaveTextContent('100000002');
	});

	it('reports Premiumize fair use in points of a 1000-point pool', async () => {
		const onLogout = vi.fn();
		fireMock
			.mockResolvedValueOnce({ isDismissed: true, dismiss: dismissReasons.cancel })
			.mockResolvedValueOnce({ isConfirmed: true });

		render(
			<ServiceCard
				service="pm"
				user={basePmUser}
				onTraktLogin={vi.fn()}
				onLogout={onLogout}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: /Premiumize/ }));

		await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
		expect(fireMock.mock.calls[0][0].title).toBe('Premiumize');
		expect(fireMock.mock.calls[0][0].html).toContain('38.1 of 1000 points');
		expect(onLogout).toHaveBeenCalledWith('pm:');
	});

	it('identifies Offcloud by the local part of its email', () => {
		render(
			<ServiceCard service="oc" user={baseOcUser} onTraktLogin={vi.fn()} onLogout={vi.fn()} />
		);

		expect(screen.getByRole('button', { name: /Offcloud/ })).toHaveTextContent('oc-user');
	});

	it('shows the Offcloud expiry date verbatim - it is a string, not a timestamp', async () => {
		const onLogout = vi.fn();
		fireMock
			.mockResolvedValueOnce({ isDismissed: true, dismiss: dismissReasons.cancel })
			.mockResolvedValueOnce({ isConfirmed: true });

		render(
			<ServiceCard
				service="oc"
				user={baseOcUser}
				onTraktLogin={vi.fn()}
				onLogout={onLogout}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: /Offcloud/ }));

		await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
		expect(fireMock.mock.calls[0][0].title).toBe('Offcloud');
		expect(fireMock.mock.calls[0][0].html).toContain('oc-user@example.com');
		expect(fireMock.mock.calls[0][0].html).toContain('2026-10-02');
		expect(onLogout).toHaveBeenCalledWith('oc:');
	});

	it('marks a non-premium Offcloud account as unusable', () => {
		render(
			<ServiceCard
				service="oc"
				user={{ ...baseOcUser, is_premium: false }}
				onTraktLogin={vi.fn()}
				onLogout={vi.fn()}
			/>
		);

		// The premium tick is the X, not the check - a free account cannot download.
		expect(
			screen.getByRole('button', { name: /Offcloud/ }).querySelector('.text-red-500')
		).toBeTruthy();
	});

	it('identifies Debrid-Link by its username', () => {
		render(
			<ServiceCard service="dl" user={baseDlUser} onTraktLogin={vi.fn()} onLogout={vi.fn()} />
		);

		expect(screen.getByRole('button', { name: /Debrid-Link/ })).toHaveTextContent('ymsita');
	});

	// `premiumLeft` is seconds remaining, not a timestamp - read as one it dates
	// the account to 1970.
	it('turns the Debrid-Link premiumLeft seconds into days', async () => {
		const onLogout = vi.fn();
		fireMock
			.mockResolvedValueOnce({ isDismissed: true, dismiss: dismissReasons.cancel })
			.mockResolvedValueOnce({ isConfirmed: true });

		render(
			<ServiceCard
				service="dl"
				user={baseDlUser}
				onTraktLogin={vi.fn()}
				onLogout={onLogout}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: /Debrid-Link/ }));

		await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
		expect(fireMock.mock.calls[0][0].title).toBe('Debrid-Link');
		// 3,628,800 seconds is 42 days
		expect(fireMock.mock.calls[0][0].html).toContain('<strong>Days Remaining:</strong> 42');
		expect(fireMock.mock.calls[0][0].html).toContain('ymsita');
		expect(fireMock.mock.calls[0][0].html).not.toContain('1970');
		expect(onLogout).toHaveBeenCalledWith('dl:');
	});

	it('marks a free Debrid-Link account as unusable', () => {
		render(
			<ServiceCard
				service="dl"
				user={{ ...baseDlUser, accountType: 0 }}
				onTraktLogin={vi.fn()}
				onLogout={vi.fn()}
			/>
		);

		// The seedbox is premium-only, so a free account gets the X.
		expect(
			screen.getByRole('button', { name: /Debrid-Link/ }).querySelector('.text-red-500')
		).toBeTruthy();
	});

	it('presents login buttons when accounts are missing', async () => {
		const onLogin = vi.fn();
		render(
			<div className="space-y-2">
				<ServiceCard service="rd" user={null} onTraktLogin={onLogin} onLogout={vi.fn()} />
				<ServiceCard service="tb" user={null} onTraktLogin={onLogin} onLogout={vi.fn()} />
				<ServiceCard service="pm" user={null} onTraktLogin={onLogin} onLogout={vi.fn()} />
				<ServiceCard service="oc" user={null} onTraktLogin={onLogin} onLogout={vi.fn()} />
				<ServiceCard service="dl" user={null} onTraktLogin={onLogin} onLogout={vi.fn()} />
				<ServiceCard
					service="trakt"
					user={null}
					onTraktLogin={onLogin}
					onLogout={vi.fn()}
				/>
			</div>
		);

		const loginButtons = screen.getAllByRole('button', { name: /Login/ });
		expect(loginButtons).toHaveLength(6);
		for (const button of loginButtons) {
			await userEvent.click(button);
		}
		expect(onLogin).toHaveBeenCalledTimes(6);
	});
});
