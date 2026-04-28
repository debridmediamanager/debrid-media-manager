import { createMockRequest, createMockResponse } from '@/test/utils/api';
import crypto from 'crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/torbox', () => ({
	getUserData: vi.fn(),
}));

import { getUserData } from '@/services/torbox';
import {
	decryptApiKey,
	encryptApiKey,
	generateTorBoxUserId,
	handleApiError,
	validateApiKey,
	validateMethod,
	validateTorBoxApiKey,
} from './torboxCastApiHelpers';

const originalSalt = process.env.DMMCAST_SALT;
const testSalt = 'test-tb-salt';

describe('torboxCastApiHelpers', () => {
	beforeEach(() => {
		process.env.DMMCAST_SALT = testSalt;
		vi.mocked(getUserData).mockReset();
	});

	afterAll(() => {
		process.env.DMMCAST_SALT = originalSalt;
	});

	describe('validateMethod', () => {
		it('returns true for allowed method', () => {
			const req = createMockRequest({ method: 'POST' });
			const res = createMockResponse();
			expect(validateMethod(req, res, ['POST'])).toBe(true);
		});

		it('returns false and sets 405 for disallowed method', () => {
			const req = createMockRequest({ method: 'PATCH' });
			const res = createMockResponse();
			expect(validateMethod(req, res, ['GET'])).toBe(false);
			expect(res._getStatusCode()).toBe(405);
		});
	});

	describe('validateApiKey', () => {
		it('returns apiKey from query', () => {
			const req = createMockRequest({ query: { apiKey: 'tb-key' } });
			const res = createMockResponse();
			expect(validateApiKey(req, res)).toBe('tb-key');
		});

		it('returns apiKey from body', () => {
			const req = createMockRequest({ body: { apiKey: 'body-tb-key' } });
			const res = createMockResponse();
			expect(validateApiKey(req, res)).toBe('body-tb-key');
		});

		it('returns null and sets 401 when missing', () => {
			const req = createMockRequest();
			const res = createMockResponse();
			expect(validateApiKey(req, res)).toBeNull();
			expect(res._getStatusCode()).toBe(401);
		});
	});

	describe('generateTorBoxUserId', () => {
		it('generates deterministic user id from email', async () => {
			vi.mocked(getUserData).mockResolvedValue({
				success: true,
				data: { email: 'user@example.com' },
			} as any);

			const result = await generateTorBoxUserId('tb-api-key');

			expect(getUserData).toHaveBeenCalledWith('tb-api-key');
			const expected = crypto
				.createHmac('sha256', testSalt)
				.update('torbox:user@example.com')
				.digest('base64url')
				.slice(0, 12);
			expect(result).toBe(expected);
		});

		it('throws when email is not available', async () => {
			vi.mocked(getUserData).mockResolvedValue({
				success: true,
				data: {},
			} as any);

			await expect(generateTorBoxUserId('bad-key')).rejects.toThrow(
				'Failed to generate TorBox user ID'
			);
		});

		it('throws when success is false', async () => {
			vi.mocked(getUserData).mockResolvedValue({
				success: false,
				data: null,
			} as any);

			await expect(generateTorBoxUserId('bad-key')).rejects.toThrow(
				'Failed to generate TorBox user ID'
			);
		});

		it('throws when DMMCAST_SALT is missing', async () => {
			delete process.env.DMMCAST_SALT;
			vi.mocked(getUserData).mockResolvedValue({
				success: true,
				data: { email: 'user@example.com' },
			} as any);

			await expect(generateTorBoxUserId('key')).rejects.toThrow(
				'Failed to generate TorBox user ID'
			);
		});

		it('throws when getUserData rejects', async () => {
			vi.mocked(getUserData).mockRejectedValue(new Error('API error'));

			await expect(generateTorBoxUserId('key')).rejects.toThrow(
				'Failed to generate TorBox user ID'
			);
		});
	});

	describe('validateTorBoxApiKey', () => {
		it('returns valid with email for valid key', async () => {
			vi.mocked(getUserData).mockResolvedValue({
				success: true,
				data: { email: 'user@tb.com' },
			} as any);

			const result = await validateTorBoxApiKey('valid-key');

			expect(result).toEqual({ valid: true, email: 'user@tb.com' });
		});

		it('returns invalid when success is false', async () => {
			vi.mocked(getUserData).mockResolvedValue({
				success: false,
				data: null,
			} as any);

			const result = await validateTorBoxApiKey('bad-key');

			expect(result).toEqual({ valid: false });
		});

		it('returns invalid when email is missing', async () => {
			vi.mocked(getUserData).mockResolvedValue({
				success: true,
				data: {},
			} as any);

			const result = await validateTorBoxApiKey('bad-key');

			expect(result).toEqual({ valid: false });
		});

		it('returns invalid on error', async () => {
			vi.mocked(getUserData).mockRejectedValue(new Error('fail'));

			const result = await validateTorBoxApiKey('bad-key');

			expect(result).toEqual({ valid: false });
		});
	});

	describe('handleApiError', () => {
		it('sends 500 with default message', () => {
			const res = createMockResponse();
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			handleApiError(new Error('boom'), res);

			expect(res._getStatusCode()).toBe(500);
			expect(res._getData()).toEqual({
				error: 'Internal Server Error: boom',
			});
			consoleSpy.mockRestore();
		});

		it('sends 500 with custom message', () => {
			const res = createMockResponse();
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			handleApiError('err', res, 'Custom TorBox error');

			expect(res._getData()).toEqual({ error: 'Custom TorBox error' });
			consoleSpy.mockRestore();
		});
	});

	describe('encryptApiKey / decryptApiKey', () => {
		it('returns the same key (passthrough)', () => {
			const key = 'my-torbox-key';
			expect(encryptApiKey(key)).toBe(key);
			expect(decryptApiKey(key)).toBe(key);
		});

		it('roundtrips correctly', () => {
			const key = 'tb-key-456';
			expect(decryptApiKey(encryptApiKey(key))).toBe(key);
		});
	});
});
