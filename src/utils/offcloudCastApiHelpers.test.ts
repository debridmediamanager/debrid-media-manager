import { getOffcloudAccountInfo } from '@/services/offcloud';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateOffcloudUserId, resolveOffcloudUser } from './offcloudCastApiHelpers';

vi.mock('@/services/offcloud', () => ({ getOffcloudAccountInfo: vi.fn() }));

const mockInfo = vi.mocked(getOffcloudAccountInfo);
const originalSalt = process.env.DMMCAST_SALT;

describe('offcloudCastApiHelpers', () => {
	beforeEach(() => {
		process.env.DMMCAST_SALT = 'test-oc-salt';
		mockInfo.mockReset();
	});

	afterAll(() => {
		process.env.DMMCAST_SALT = originalSalt;
	});

	it('answers validity and the user id in one round trip', async () => {
		mockInfo.mockResolvedValue({ user_id: '100000001' } as any);

		const result = await resolveOffcloudUser('key');

		expect(result.valid).toBe(true);
		expect(result.userId).toHaveLength(12);
		expect(mockInfo).toHaveBeenCalledTimes(1);
	});

	it('is stable for the same account and different across accounts', async () => {
		mockInfo.mockResolvedValue({ user_id: '100000001' } as any);
		const first = await generateOffcloudUserId('key');
		const again = await generateOffcloudUserId('key');
		mockInfo.mockResolvedValue({ user_id: '111111111' } as any);
		const other = await generateOffcloudUserId('key');

		expect(first).toBe(again);
		expect(other).not.toBe(first);
	});

	// Namespaced so an Offcloud user id can never collide with the id another
	// provider derives from the same string.
	it('is namespaced away from the other providers', async () => {
		mockInfo.mockResolvedValue({ user_id: 'shared-identifier' } as any);
		const oc = await generateOffcloudUserId('key');

		const crypto = await import('crypto');
		const unprefixed = crypto
			.createHmac('sha256', 'test-oc-salt')
			.update('shared-identifier')
			.digest('base64url')
			.slice(0, 12);
		const premiumize = crypto
			.createHmac('sha256', 'test-oc-salt')
			.update('premiumize:shared-identifier')
			.digest('base64url')
			.slice(0, 12);

		expect(oc).not.toBe(unprefixed);
		expect(oc).not.toBe(premiumize);
	});

	// Offcloud reports `user_id` as a string, but nothing in its (nonexistent)
	// documentation promises that, and a number would otherwise blow up on
	// `update()`.
	it('accepts a numeric user id', async () => {
		mockInfo.mockResolvedValue({ user_id: 100000001 } as any);
		const result = await resolveOffcloudUser('key');
		expect(result.valid).toBe(true);
		expect(result.accountUserId).toBe('100000001');
	});

	it('reports an unusable key without a user id', async () => {
		mockInfo.mockResolvedValue({} as any);
		expect(await resolveOffcloudUser('key')).toEqual({ valid: false });
	});

	it('reports a thrown lookup as an invalid key', async () => {
		mockInfo.mockRejectedValue(new Error('NOAUTH'));
		expect(await resolveOffcloudUser('key')).toEqual({ valid: false });
		await expect(generateOffcloudUserId('key')).rejects.toThrow(
			'Failed to generate Offcloud user ID'
		);
	});

	// A missing salt is our misconfiguration, not a bad key
	it('surfaces a missing salt rather than calling the key invalid', async () => {
		delete process.env.DMMCAST_SALT;
		mockInfo.mockResolvedValue({ user_id: '100000001' } as any);
		await expect(resolveOffcloudUser('key')).rejects.toThrow('DMMCAST_SALT');
	});
});
