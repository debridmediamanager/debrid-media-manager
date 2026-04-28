import { beforeEach, describe, expect, it, vi } from 'vitest';

const modalFireMock = vi.fn();
const openMock = vi.fn();

vi.mock('../components/modals/modal', () => ({
	__esModule: true,
	default: {
		fire: (...args: any[]) => modalFireMock(...args),
	},
}));

import { checkPremiumStatus } from './premiumCheck';

describe('checkPremiumStatus', () => {
	beforeEach(() => {
		modalFireMock.mockReset();
		openMock.mockReset();
		window.open = openMock as any;
		localStorage.clear();
	});

	it('forces logout for non-premium users and opens the upgrade page on confirm', async () => {
		modalFireMock.mockResolvedValue({ isConfirmed: true });
		const result = await checkPremiumStatus({
			premium: 0,
			expiration: new Date().toISOString(),
		} as any);

		expect(modalFireMock).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Premium Required' })
		);
		expect(openMock).toHaveBeenCalledWith(
			'https://real-debrid.com/premium?id=11137529',
			'_blank'
		);
		expect(result).toEqual({ shouldLogout: true });
	});

	it('warns users when premium expires soon and throttles warnings', async () => {
		modalFireMock.mockResolvedValue({ isConfirmed: false });
		localStorage.setItem(
			'rd_premium_warning',
			(Date.now() - 2 * 24 * 60 * 60 * 1000).toString()
		);

		const result = await checkPremiumStatus({
			premium: 6 * 24 * 60 * 60,
			expiration: new Date().toISOString(),
		} as any);

		expect(result).toEqual({ shouldLogout: false });
		expect(modalFireMock).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Premium Expiring Soon' })
		);
		expect(localStorage.getItem('rd_premium_warning')).not.toBeNull();
	});

	it('does nothing when membership has plenty of time remaining', async () => {
		await checkPremiumStatus({
			premium: 10 * 24 * 60 * 60,
			expiration: new Date().toISOString(),
		} as any);

		expect(modalFireMock).not.toHaveBeenCalled();
	});
});
