import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	getAllDebridUser: vi.fn(),
	torboxUserId: vi.fn(),
	getPremiumizeAccountInfo: vi.fn(),
	getOffcloudAccountInfo: vi.fn(),
	getDebridLinkAccountInfo: vi.fn(),
}));
vi.mock('@/services/realDebrid', () => ({ getCurrentUser: providers.getCurrentUser }));
vi.mock('@/services/allDebrid', () => ({ getAllDebridUser: providers.getAllDebridUser }));
vi.mock('@/utils/torboxIdentity', () => ({ torboxUserId: providers.torboxUserId }));
vi.mock('@/services/premiumize', () => ({
	getPremiumizeAccountInfo: providers.getPremiumizeAccountInfo,
}));
vi.mock('@/services/offcloud', () => ({
	getOffcloudAccountInfo: providers.getOffcloudAccountInfo,
}));
vi.mock('@/services/debridLink', () => ({
	getDebridLinkAccountInfo: providers.getDebridLinkAccountInfo,
}));

import { JEV_REPORTER } from './reporterId';
import { verifiedReporterId } from './verifiedReporterId';

// Key shapes as stored in Report on 2026-10-18; the values are made up.
const RD_KEY = 'Q'.repeat(52);
const RD_KEY_2 = 'R'.repeat(52);
const TB_KEY = '0f8c2e5a-1b2c-4d5e-8f90-123456789abc';
const AD_KEY = 'abcDEF123ghiJKL456mn';

describe('verifiedReporterId', () => {
	const originalSalt = process.env.DMMCAST_SALT;
	beforeEach(() => {
		vi.resetAllMocks();
		process.env.DMMCAST_SALT = 'test-salt';
	});
	afterEach(() => {
		process.env.DMMCAST_SALT = originalSalt;
	});

	it('refuses made-up keys, so one person cannot be two reporters', async () => {
		providers.getCurrentUser.mockRejectedValue(new Error('bad_token'));
		providers.getAllDebridUser.mockRejectedValue(new Error('AUTH_BAD_APIKEY'));
		providers.torboxUserId.mockResolvedValue(null);

		expect(await verifiedReporterId(RD_KEY)).toBeNull();
		expect(await verifiedReporterId(AD_KEY)).toBeNull();
		expect(await verifiedReporterId(TB_KEY)).toBeNull();
		expect(await verifiedReporterId('made-up')).toBeNull();
	});

	it('names the account, not the key: two RD tokens of one account are one reporter', async () => {
		providers.getCurrentUser.mockResolvedValue({ id: 4242, username: 'someone' });

		const first = await verifiedReporterId(RD_KEY);
		expect(first).toMatch(/^rd:[\w-]{16}$/);
		expect(first).not.toContain(RD_KEY);
		expect(await verifiedReporterId(RD_KEY_2)).toBe(first);

		providers.getCurrentUser.mockResolvedValue({ id: 4243, username: 'other' });
		expect(await verifiedReporterId(RD_KEY_2)).not.toBe(first);
	});

	it('asks each service by its key shape or tag', async () => {
		providers.getAllDebridUser.mockResolvedValue({ username: 'ad-user' });
		providers.torboxUserId.mockResolvedValue('tb:abcdefabcdef');
		providers.getPremiumizeAccountInfo.mockResolvedValue({ customer_id: '704233992' });
		providers.getOffcloudAccountInfo.mockResolvedValue({ user_id: 'oc-1' });
		providers.getDebridLinkAccountInfo.mockResolvedValue({ username: 'dl-user' });

		expect(await verifiedReporterId(AD_KEY)).toMatch(/^ad:/);
		expect(providers.getAllDebridUser).toHaveBeenCalledWith(AD_KEY);
		expect(await verifiedReporterId(TB_KEY)).toBe('tb:abcdefabcdef');
		expect(await verifiedReporterId('pm:secret')).toMatch(/^pm:[\w-]{16}$/);
		expect(providers.getPremiumizeAccountInfo).toHaveBeenCalledWith('secret');
		expect(await verifiedReporterId('oc:secret')).toMatch(/^oc:/);
		expect(await verifiedReporterId('dl:secret')).toMatch(/^dl:/);
		expect(providers.getCurrentUser).not.toHaveBeenCalled();
	});

	it('never answers with the Jev reporter, whatever a client sends', async () => {
		expect(await verifiedReporterId(JEV_REPORTER)).toBeNull();
		expect(await verifiedReporterId('jev:anything')).toBeNull();
	});

	it('refuses an account its service returns without an id', async () => {
		providers.getPremiumizeAccountInfo.mockResolvedValue({ customer_id: '' });
		expect(await verifiedReporterId('pm:secret')).toBeNull();
	});
});
