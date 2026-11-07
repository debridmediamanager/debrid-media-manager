import { checkEasynewsLogin, EasynewsAuthError } from '@/services/easynews';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { easynewsCastUserId, resolveEasynewsUser } from './easynewsCastApiHelpers';
import { easynewsCastKey } from './easynewsCastKey';

vi.mock('@/services/easynews', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/easynews')>()),
	checkEasynewsLogin: vi.fn(),
}));

const mockCheck = vi.mocked(checkEasynewsLogin);
const originalSalt = process.env.DMMCAST_SALT;

describe('easynewsCastApiHelpers', () => {
	beforeEach(() => {
		process.env.DMMCAST_SALT = 'test-salt';
		mockCheck.mockReset();
	});
	afterAll(() => {
		process.env.DMMCAST_SALT = originalSalt;
	});

	// A changed password must keep the addon URL and every cast.
	it('keys the id on the username alone, case-insensitively', () => {
		const id = easynewsCastUserId('Alice');
		expect(id).toHaveLength(12);
		expect(easynewsCastUserId('alice')).toBe(id);
		expect(easynewsCastUserId('bob')).not.toBe(id);
	});

	it('throws without DMMCAST_SALT rather than minting a guessable id', () => {
		delete process.env.DMMCAST_SALT;
		expect(() => easynewsCastUserId('alice')).toThrow(/DMMCAST_SALT/);
	});

	it('answers the id for a login Easynews accepts', async () => {
		mockCheck.mockResolvedValue();
		const key = easynewsCastKey({ username: 'alice', password: 'pw' });
		await expect(resolveEasynewsUser(key)).resolves.toEqual({
			valid: true,
			userId: easynewsCastUserId('alice'),
			credentials: { username: 'alice', password: 'pw' },
		});
		expect(mockCheck).toHaveBeenCalledWith({ username: 'alice', password: 'pw' });
	});

	it('reports a refused login as invalid', async () => {
		mockCheck.mockRejectedValue(new EasynewsAuthError());
		const key = easynewsCastKey({ username: 'alice', password: 'wrong' });
		await expect(resolveEasynewsUser(key)).resolves.toEqual({ valid: false });
	});

	it('does not call Easynews for a malformed key', async () => {
		await expect(resolveEasynewsUser('%%%')).resolves.toEqual({ valid: false });
		expect(mockCheck).not.toHaveBeenCalled();
	});

	// Easynews being down is not the member's wrong password.
	it('lets an outage through as an error', async () => {
		mockCheck.mockRejectedValue(new Error('Easynews login check failed: HTTP 502'));
		const key = easynewsCastKey({ username: 'alice', password: 'pw' });
		await expect(resolveEasynewsUser(key)).rejects.toThrow(/502/);
	});
});
