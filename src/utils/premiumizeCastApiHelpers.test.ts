import { getPremiumizeAccountInfo } from '@/services/premiumize';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePremiumizeUserId, resolvePremiumizeUser } from './premiumizeCastApiHelpers';

vi.mock('@/services/premiumize', () => ({ getPremiumizeAccountInfo: vi.fn() }));

const mockInfo = vi.mocked(getPremiumizeAccountInfo);
const originalSalt = process.env.DMMCAST_SALT;

describe('premiumizeCastApiHelpers', () => {
	beforeEach(() => {
		process.env.DMMCAST_SALT = 'test-pm-salt';
		mockInfo.mockReset();
	});

	afterAll(() => {
		process.env.DMMCAST_SALT = originalSalt;
	});

	it('answers validity and the user id in one round trip', async () => {
		mockInfo.mockResolvedValue({ customer_id: '704233992' } as any);

		const result = await resolvePremiumizeUser('key');

		expect(result.valid).toBe(true);
		expect(result.userId).toHaveLength(12);
		expect(mockInfo).toHaveBeenCalledTimes(1);
	});

	it('is stable for the same customer and different across accounts', async () => {
		mockInfo.mockResolvedValue({ customer_id: '704233992' } as any);
		const first = await generatePremiumizeUserId('key');
		const again = await generatePremiumizeUserId('key');
		mockInfo.mockResolvedValue({ customer_id: '999999999' } as any);
		const other = await generatePremiumizeUserId('key');

		expect(first).toBe(again);
		expect(other).not.toBe(first);
	});

	// Namespaced so a Premiumize customer id can never collide with the id another
	// provider derives from the same string.
	it('is namespaced away from the other providers', async () => {
		mockInfo.mockResolvedValue({ customer_id: 'shared-identifier' } as any);
		const pm = await generatePremiumizeUserId('key');

		const crypto = await import('crypto');
		const unprefixed = crypto
			.createHmac('sha256', 'test-pm-salt')
			.update('shared-identifier')
			.digest('base64url')
			.slice(0, 12);

		expect(pm).not.toBe(unprefixed);
	});

	it('reports an unusable key without a user id', async () => {
		mockInfo.mockResolvedValue({} as any);
		expect(await resolvePremiumizeUser('key')).toEqual({ valid: false });
	});

	it('reports a thrown lookup as an invalid key', async () => {
		mockInfo.mockRejectedValue(new Error('network'));
		expect(await resolvePremiumizeUser('key')).toEqual({ valid: false });
		await expect(generatePremiumizeUserId('key')).rejects.toThrow(
			'Failed to generate Premiumize user ID'
		);
	});

	// A missing salt is our misconfiguration, not a bad key
	it('surfaces a missing salt rather than calling the key invalid', async () => {
		delete process.env.DMMCAST_SALT;
		mockInfo.mockResolvedValue({ customer_id: '704233992' } as any);
		await expect(resolvePremiumizeUser('key')).rejects.toThrow('DMMCAST_SALT');
	});
});
