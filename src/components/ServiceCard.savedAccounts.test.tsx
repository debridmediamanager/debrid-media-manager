import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return { clear: vi.fn() };
	}),
}));

import { listSavedAccounts, parkCurrentAccount } from '@/utils/savedAccounts';
import { ServiceCard, accountIdentity } from './ServiceCard';

const rdUser = {
	id: 42,
	username: 'dad',
	email: 'dad@example.com',
	points: 10,
	locale: 'en',
	avatar: '',
	type: 'premium',
	premium: 172800,
	expiration: new Date(Date.now() + 86400000).toISOString(),
} as any;

const realLocation = window.location;

describe('ServiceCard saved accounts', () => {
	const assign = vi.fn();

	beforeEach(() => {
		localStorage.clear();
		modalControls.fireMock.mockReset();
		assign.mockReset();
		Object.defineProperty(window, 'location', {
			configurable: true,
			writable: true,
			value: { ...realLocation, assign, reload: vi.fn() },
		});
	});

	afterEach(() => {
		Object.defineProperty(window, 'location', {
			configurable: true,
			writable: true,
			value: realLocation,
		});
	});

	it('renders the bare card for a single-account user', () => {
		localStorage.setItem('rd:accessToken', '"dad-key"');
		const { container } = render(
			<ServiceCard service="rd" user={rdUser} onTraktLogin={vi.fn()} onLogout={vi.fn()} />
		);
		expect(container.firstElementChild?.tagName).toBe('BUTTON');
		expect(screen.queryByText('Switch to')).not.toBeInTheDocument();
	});

	it('offers "Add another account" and parks the login on the way to the login page', async () => {
		localStorage.setItem('rd:accessToken', '"dad-key"');
		localStorage.setItem('rd:refreshToken', '"dad-device"');
		modalControls.fireMock.mockResolvedValue({ isConfirmed: false, isDenied: true });

		render(
			<ServiceCard service="rd" user={rdUser} onTraktLogin={vi.fn()} onLogout={vi.fn()} />
		);
		await userEvent.click(screen.getByRole('button', { name: /Real-Debrid/ }));

		expect(modalControls.fireMock).toHaveBeenCalledWith(
			expect.objectContaining({ showDenyButton: true, denyButtonText: 'Add another account' })
		);
		await waitFor(() => expect(assign).toHaveBeenCalledWith('/realdebrid/login'));
		expect(localStorage.getItem('rd:accessToken')).toBeNull();
		expect(listSavedAccounts('rd:')).toEqual([
			expect.objectContaining({
				id: '42',
				label: 'dad',
				keys: { 'rd:accessToken': '"dad-key"', 'rd:refreshToken': '"dad-device"' },
			}),
		]);
	});

	it('shows the switch row once another login is saved, and swaps on click', async () => {
		localStorage.setItem('rd:accessToken', '"son-key"');
		await parkCurrentAccount('rd:', { id: '7', label: 'son' });
		localStorage.setItem('rd:accessToken', '"dad-key"');

		render(
			<ServiceCard service="rd" user={rdUser} onTraktLogin={vi.fn()} onLogout={vi.fn()} />
		);

		expect(await screen.findByText('Switch to')).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'son' }));

		await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
		expect(localStorage.getItem('rd:accessToken')).toBe('"son-key"');
		// dad is parked in son's place, filed under his Real-Debrid id
		expect(listSavedAccounts('rd:').map((a) => [a.id, a.label])).toEqual([['42', 'dad']]);
	});

	it('never offers it for Trakt, which is not a debrid login', async () => {
		modalControls.fireMock.mockResolvedValue({ isConfirmed: true });
		const traktUser = {
			user: { username: 't', joined_at: '2020-01-01', private: false, vip: false },
		} as any;
		render(
			<ServiceCard
				service="trakt"
				user={traktUser}
				onTraktLogin={vi.fn()}
				onLogout={vi.fn()}
			/>
		);
		await userEvent.click(screen.getByRole('button'));
		expect(modalControls.fireMock).toHaveBeenCalledWith(
			expect.objectContaining({ showDenyButton: false })
		);
	});

	it('files each provider under its own stable id', () => {
		expect(accountIdentity('rd', rdUser)).toEqual({ id: '42', label: 'dad' });
		expect(accountIdentity('ad', { username: 'ad-user' } as any)).toEqual({
			id: 'ad-user',
			label: 'ad-user',
		});
		expect(accountIdentity('tb', { id: 9, email: 'tb@example.com' } as any)).toEqual({
			id: '9',
			label: 'tb',
		});
		expect(accountIdentity('pm', { customer_id: '100000002' } as any)).toEqual({
			id: '100000002',
			label: '100000002',
		});
		expect(accountIdentity('oc', { user_id: 'u1', email: 'oc@example.com' } as any)).toEqual({
			id: 'u1',
			label: 'oc',
		});
		expect(accountIdentity('dl', { username: 'dl-user' } as any)).toEqual({
			id: 'dl-user',
			label: 'dl-user',
		});
		expect(accountIdentity('trakt', { user: {} } as any)).toBeNull();
		expect(accountIdentity('rd', null)).toBeNull();
	});
});
