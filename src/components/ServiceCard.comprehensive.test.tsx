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

const nonPremiumRdUser = {
	...baseRdUser,
	premium: 0,
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

const nonPremiumAdUser = {
	...baseAdUser,
	isPremium: false,
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

const expiredTbUser = {
	...baseTbUser,
	premium_expires_at: new Date('2020-01-01').toISOString(),
} as any;

const tbUserWithCooldown = {
	...baseTbUser,
	cooldown_until: new Date(Date.now() + 86400000).toISOString(),
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

describe('ServiceCard - comprehensive', () => {
	describe('Real-Debrid', () => {
		it('shows non-premium indicator for non-premium RD user', () => {
			render(
				<ServiceCard
					service="rd"
					user={nonPremiumRdUser}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
			);
			const button = screen.getByRole('button', { name: /Real-Debrid/i });
			expect(button).toBeInTheDocument();
			expect(button).toHaveTextContent('rd-user');
		});

		it('cancels logout when confirmation is declined', async () => {
			const onLogout = vi.fn();
			fireMock
				.mockResolvedValueOnce({ isDismissed: true, dismiss: dismissReasons.cancel })
				.mockResolvedValueOnce({ isConfirmed: false, isDismissed: true });

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
			expect(onLogout).not.toHaveBeenCalled();
		});

		it('closes modal without triggering logout when Close is clicked', async () => {
			const onLogout = vi.fn();
			fireMock.mockResolvedValueOnce({ isConfirmed: true });

			render(
				<ServiceCard
					service="rd"
					user={baseRdUser}
					onTraktLogin={vi.fn()}
					onLogout={onLogout}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /Real-Debrid/i }));
			await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));
			expect(onLogout).not.toHaveBeenCalled();
		});

		it('shows RD user details in modal html', async () => {
			fireMock.mockResolvedValueOnce({ isConfirmed: true });

			render(
				<ServiceCard
					service="rd"
					user={baseRdUser}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /Real-Debrid/i }));
			await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));

			const modalArgs = fireMock.mock.calls[0][0];
			expect(modalArgs.html).toContain('rd-user');
			expect(modalArgs.html).toContain('rd@example.com');
			expect(modalArgs.html).toContain('10');
		});
	});

	describe('AllDebrid', () => {
		it('shows login button when user is null', () => {
			const onLogin = vi.fn();
			render(
				<ServiceCard service="ad" user={null} onTraktLogin={onLogin} onLogout={vi.fn()} />
			);
			const button = screen.getByRole('button', { name: /AllDebrid Login/i });
			expect(button).toBeInTheDocument();
		});

		it('calls onTraktLogin when AD login button is clicked', async () => {
			const onLogin = vi.fn();
			render(
				<ServiceCard service="ad" user={null} onTraktLogin={onLogin} onLogout={vi.fn()} />
			);
			await userEvent.click(screen.getByRole('button', { name: /AllDebrid Login/i }));
			expect(onLogin).toHaveBeenCalledTimes(1);
		});

		it('shows non-premium indicator for non-premium AD user', () => {
			render(
				<ServiceCard
					service="ad"
					user={nonPremiumAdUser}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
			);
			expect(screen.getByRole('button', { name: /AllDebrid/i })).toHaveTextContent('ad-user');
		});

		it('shows AD user details including fidelity points', async () => {
			fireMock.mockResolvedValueOnce({ isConfirmed: true });

			render(
				<ServiceCard
					service="ad"
					user={baseAdUser}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /AllDebrid/i }));
			await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));
			const modalArgs = fireMock.mock.calls[0][0];
			expect(modalArgs.html).toContain('ad-user');
			expect(modalArgs.html).toContain('12');
			expect(modalArgs.title).toBe('AllDebrid');
		});

		it('triggers AD logout flow', async () => {
			const onLogout = vi.fn();
			fireMock
				.mockResolvedValueOnce({ isDismissed: true, dismiss: dismissReasons.cancel })
				.mockResolvedValueOnce({ isConfirmed: true });

			render(
				<ServiceCard
					service="ad"
					user={baseAdUser}
					onTraktLogin={vi.fn()}
					onLogout={onLogout}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /AllDebrid/i }));
			await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
			expect(onLogout).toHaveBeenCalledWith('ad:');
		});
	});

	describe('TorBox', () => {
		it('shows expired premium indicator', () => {
			render(
				<ServiceCard
					service="tb"
					user={expiredTbUser}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
			);
			expect(screen.getByRole('button', { name: /Torbox/i })).toBeInTheDocument();
		});

		it('shows cooldown info in modal when active', async () => {
			fireMock.mockResolvedValueOnce({ isConfirmed: true });

			render(
				<ServiceCard
					service="tb"
					user={tbUserWithCooldown}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /Torbox/i }));
			await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));
			const modalArgs = fireMock.mock.calls[0][0];
			expect(modalArgs.html).toContain('Cooldown Until');
		});

		it('shows plan names correctly in modal', async () => {
			const plans = [
				{ plan: 2, expected: 'Pro' },
				{ plan: 1, expected: 'Standard' },
				{ plan: 0, expected: 'Essential' },
				{ plan: -1, expected: 'Free' },
			];

			for (const { plan, expected } of plans) {
				fireMock.mockReset();
				fireMock.mockResolvedValueOnce({ isConfirmed: true });

				const { unmount } = render(
					<ServiceCard
						service="tb"
						user={{ ...baseTbUser, plan }}
						onTraktLogin={vi.fn()}
						onLogout={vi.fn()}
					/>
				);

				await userEvent.click(screen.getByRole('button', { name: /Torbox/i }));
				await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));
				expect(fireMock.mock.calls[0][0].html).toContain(expected);
				unmount();
			}
		});

		it('triggers TB logout flow', async () => {
			const onLogout = vi.fn();
			fireMock
				.mockResolvedValueOnce({ isDismissed: true, dismiss: dismissReasons.cancel })
				.mockResolvedValueOnce({ isConfirmed: true });

			render(
				<ServiceCard
					service="tb"
					user={baseTbUser}
					onTraktLogin={vi.fn()}
					onLogout={onLogout}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /Torbox/i }));
			await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
			expect(onLogout).toHaveBeenCalledWith('tb:');
		});
	});

	describe('Trakt', () => {
		it('shows Trakt user details in modal', async () => {
			fireMock.mockResolvedValueOnce({ isConfirmed: true });

			render(
				<ServiceCard
					service="trakt"
					user={baseTraktUser}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /Trakt/i }));
			await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));
			const modalArgs = fireMock.mock.calls[0][0];
			expect(modalArgs.html).toContain('trakt-user');
			expect(modalArgs.html).toContain('No');
			expect(modalArgs.html).toContain('Yes');
			expect(modalArgs.title).toBe('Trakt');
		});

		it('triggers Trakt logout flow', async () => {
			const onLogout = vi.fn();
			fireMock
				.mockResolvedValueOnce({ isDismissed: true, dismiss: dismissReasons.cancel })
				.mockResolvedValueOnce({ isConfirmed: true });

			render(
				<ServiceCard
					service="trakt"
					user={baseTraktUser}
					onTraktLogin={vi.fn()}
					onLogout={onLogout}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /Trakt/i }));
			await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
			expect(onLogout).toHaveBeenCalledWith('trakt:');
		});
	});

	describe('edge cases', () => {
		it('returns null for unknown service type', () => {
			const { container } = render(
				<ServiceCard
					service={'unknown' as any}
					user={null}
					onTraktLogin={vi.fn()}
					onLogout={vi.fn()}
				/>
			);
			expect(container.innerHTML).toBe('');
		});
	});
});
