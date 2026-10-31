import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return { clear: vi.fn() };
	}),
}));

import { listSavedAccounts, parkCurrentAccount } from '@/utils/savedAccounts';
import { SavedAccountsPicker } from './SavedAccountsPicker';

describe('SavedAccountsPicker', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('renders nothing for a single-account user', () => {
		localStorage.setItem('rd:accessToken', '"only-one"');
		const { container } = render(<SavedAccountsPicker prefix="rd:" current={null} />);
		expect(container).toBeEmptyDOMElement();
	});

	it('offers each saved account and swaps on click', async () => {
		localStorage.setItem('rd:accessToken', '"dad-key"');
		await parkCurrentAccount('rd:', { id: '1', label: 'dad' });
		localStorage.setItem('rd:accessToken', '"son-key"');
		const afterSwitch = vi.fn();

		render(
			<SavedAccountsPicker
				prefix="rd:"
				current={{ id: '2', label: 'son' }}
				afterSwitch={afterSwitch}
			/>
		);

		expect(await screen.findByText('Switch to')).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'dad' }));

		await waitFor(() => expect(afterSwitch).toHaveBeenCalledTimes(1));
		expect(localStorage.getItem('rd:accessToken')).toBe('"dad-key"');
		expect(listSavedAccounts('rd:').map((a) => a.label)).toEqual(['son']);
	});

	it('reads as "Continue as" when nobody is signed in', async () => {
		localStorage.setItem('rd:accessToken', '"dad-key"');
		await parkCurrentAccount('rd:', { id: '1', label: 'dad' });

		render(<SavedAccountsPicker prefix="rd:" current={null} afterSwitch={() => {}} />);

		expect(await screen.findByText('Continue as')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'dad' })).toBeInTheDocument();
	});

	it('follows the store when another part of the page parks an account', async () => {
		render(<SavedAccountsPicker prefix="rd:" current={null} />);
		localStorage.setItem('rd:accessToken', '"dad-key"');
		await parkCurrentAccount('rd:', { id: '1', label: 'dad' });
		expect(await screen.findByRole('button', { name: 'dad' })).toBeInTheDocument();
	});
});
