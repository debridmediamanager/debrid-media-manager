import { ServiceCard } from '@/components/ServiceCard';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const modalFire = vi.fn();

vi.mock('../../components/modals/modal', () => ({
	__esModule: true,
	default: {
		fire: (...args: unknown[]) => modalFire(...args),
		DismissReason: { cancel: 'cancel' },
	},
}));

vi.mock('lucide-react', () => ({
	__esModule: true,
	Check: () => <svg />,
	X: () => <svg />,
}));

const noop = () => undefined;

describe('ServiceCard error state', () => {
	beforeEach(() => {
		modalFire.mockReset();
		modalFire.mockResolvedValue({ isConfirmed: true });
	});

	// A failed profile call used to fall through to the `user ? ... : login`
	// branch, so a signed-in user was shown a login button with no hint that
	// anything had gone wrong.
	it('reports the failure instead of offering to log in', () => {
		render(
			<ServiceCard
				service="tb"
				user={null}
				error={new Error('TorBox profile unavailable')}
				onTraktLogin={noop}
				onLogout={noop}
			/>
		);

		expect(screen.getByText(/TorBox did not load/i)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /^Login/i })).not.toBeInTheDocument();
	});

	it('names the provider that failed', () => {
		render(
			<ServiceCard
				service="rd"
				user={null}
				error={new Error('boom')}
				onTraktLogin={noop}
				onLogout={noop}
			/>
		);

		expect(screen.getByText(/Real-Debrid did not load/i)).toBeInTheDocument();
	});

	it('falls through to the normal branches when there is no error', () => {
		render(<ServiceCard service="tb" user={null} onTraktLogin={noop} onLogout={noop} />);

		expect(screen.queryByText(/did not load/i)).not.toBeInTheDocument();
	});

	// A revoked credential fails identically on every attempt - Premiumize
	// answers `authentication_failed` to a dead key forever - so a card whose
	// only action is "tap to retry" is a dead end: it replaces the very card
	// that carries this provider's logout, leaving "Logout All" as the only
	// escape from one broken service.
	it('offers a logout for the provider that failed', async () => {
		const onLogout = vi.fn();
		render(
			<ServiceCard
				service="pm"
				user={null}
				error={new Error('Not logged in.')}
				onTraktLogin={noop}
				onLogout={onLogout}
			/>
		);

		fireEvent.click(screen.getByRole('button', { name: /log out/i }));
		await vi.waitFor(() => expect(onLogout).toHaveBeenCalledWith('pm:'));
	});

	it('does not log out when the confirmation is dismissed', async () => {
		const onLogout = vi.fn();
		modalFire.mockResolvedValue({ isConfirmed: false });
		render(
			<ServiceCard
				service="pm"
				user={null}
				error={new Error('Not logged in.')}
				onTraktLogin={noop}
				onLogout={onLogout}
			/>
		);

		fireEvent.click(screen.getByRole('button', { name: /log out/i }));
		await vi.waitFor(() => expect(modalFire).toHaveBeenCalled());
		expect(onLogout).not.toHaveBeenCalled();
	});

	// Re-running the login replaces the dead credential in place, which is the
	// one action that fixes a rotated key without also dropping the rest of the
	// provider's saved settings.
	it('offers to sign in again, which is what replaces a rotated key', () => {
		const onLogin = vi.fn();
		render(
			<ServiceCard
				service="pm"
				user={null}
				error={new Error('Not logged in.')}
				onTraktLogin={onLogin}
				onLogout={noop}
			/>
		);

		fireEvent.click(screen.getByRole('button', { name: /sign in again/i }));
		expect(onLogin).toHaveBeenCalled();
	});

	it('keeps a retry for a failure that is merely transient', () => {
		render(
			<ServiceCard
				service="tb"
				user={null}
				error={new Error('429')}
				onTraktLogin={noop}
				onLogout={noop}
			/>
		);

		expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
	});

	// Every provider reaches this branch, so every provider needs its own
	// prefix - logging out of a failed Debrid-Link with `pm:` would leave the
	// broken card exactly where it was.
	it.each([
		['rd', 'rd:'],
		['ad', 'ad:'],
		['tb', 'tb:'],
		['pm', 'pm:'],
		['oc', 'oc:'],
		['dl', 'dl:'],
		['trakt', 'trakt:'],
	] as const)('logs out of %s with its own key prefix', async (service, prefix) => {
		const onLogout = vi.fn();
		render(
			<ServiceCard
				service={service}
				user={null}
				error={new Error('boom')}
				onTraktLogin={noop}
				onLogout={onLogout}
			/>
		);

		fireEvent.click(screen.getByRole('button', { name: /log out/i }));
		await vi.waitFor(() => expect(onLogout).toHaveBeenCalledWith(prefix));
	});
});
