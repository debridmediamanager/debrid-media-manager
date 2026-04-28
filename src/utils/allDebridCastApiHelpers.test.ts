import { createMockRequest, createMockResponse } from '@/test/utils/api';
import crypto from 'crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/allDebrid', () => ({
	getAllDebridUser: vi.fn(),
}));

import { getAllDebridUser } from '@/services/allDebrid';
import {
	decryptApiKey,
	encryptApiKey,
	generateAllDebridUserId,
	handleApiError,
	validateAllDebridApiKey,
	validateApiKey,
	validateMethod,
} from './allDebridCastApiHelpers';

const originalSalt = process.env.DMMCAST_SALT;
const testSalt = 'test-ad-salt';

describe('allDebridCastApiHelpers', () => {
	beforeEach(() => {
		process.env.DMMCAST_SALT = testSalt;
		vi.mocked(getAllDebridUser).mockReset();
	});

	afterAll(() => {
		process.env.DMMCAST_SALT = originalSalt;
	});

	describe('validateMethod', () => {
		it('returns true for allowed method', () => {
			const req = createMockRequest({ method: 'GET' });
			const res = createMockResponse();
			expect(validateMethod(req, res, ['GET', 'POST'])).toBe(true);
		});

		it('returns false and sets 405 for disallowed method', () => {
			const req = createMockRequest({ method: 'DELETE' });
			const res = createMockResponse();
			expect(validateMethod(req, res, ['GET', 'POST'])).toBe(false);
			expect(res._getStatusCode()).toBe(405);
		});

		it('sets Allow header on 405', () => {
			const req = createMockRequest({ method: 'PUT' });
			const res = createMockResponse();
			validateMethod(req, res, ['GET']);
			expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET']);
		});
	});

	describe('validateApiKey', () => {
		it('returns apiKey from query', () => {
			const req = createMockRequest({ query: { apiKey: 'my-key' } });
			const res = createMockResponse();
			expect(validateApiKey(req, res)).toBe('my-key');
		});

		it('returns apiKey from body', () => {
			const req = createMockRequest({ body: { apiKey: 'body-key' } });
			const res = createMockResponse();
			expect(validateApiKey(req, res)).toBe('body-key');
		});

		it('returns null and sets 401 when missing', () => {
			const req = createMockRequest();
			const res = createMockResponse();
			expect(validateApiKey(req, res)).toBeNull();
			expect(res._getStatusCode()).toBe(401);
		});

		it('returns null for non-string apiKey', () => {
			const req = createMockRequest({ query: { apiKey: ['a', 'b'] as any } });
			const res = createMockResponse();
			expect(validateApiKey(req, res)).toBeNull();
		});
	});

	describe('generateAllDebridUserId', () => {
		it('generates deterministic user id from username', async () => {
			vi.mocked(getAllDebridUser).mockResolvedValue({ username: 'aduser1' } as any);

			const result = await generateAllDebridUserId('ad-api-key');

			expect(getAllDebridUser).toHaveBeenCalledWith('ad-api-key');
			const expected = crypto
				.createHmac('sha256', testSalt)
				.update('alldebrid:aduser1')
				.digest('base64url')
				.slice(0, 12);
			expect(result).toBe(expected);
		});

		it('throws when username is not available', async () => {
			vi.mocked(getAllDebridUser).mockResolvedValue({} as any);

			await expect(generateAllDebridUserId('bad-key')).rejects.toThrow(
				'Failed to generate AllDebrid user ID'
			);
		});

		it('throws when DMMCAST_SALT is missing', async () => {
			delete process.env.DMMCAST_SALT;
			vi.mocked(getAllDebridUser).mockResolvedValue({ username: 'user' } as any);

			await expect(generateAllDebridUserId('key')).rejects.toThrow(
				'Failed to generate AllDebrid user ID'
			);
		});

		it('throws when getAllDebridUser rejects', async () => {
			vi.mocked(getAllDebridUser).mockRejectedValue(new Error('API error'));

			await expect(generateAllDebridUserId('key')).rejects.toThrow(
				'Failed to generate AllDebrid user ID'
			);
		});
	});

	describe('validateAllDebridApiKey', () => {
		it('returns valid with username for valid key', async () => {
			vi.mocked(getAllDebridUser).mockResolvedValue({
				username: 'aduser',
				isPremium: true,
			} as any);

			const result = await validateAllDebridApiKey('valid-key');

			expect(result).toEqual({ valid: true, username: 'aduser', isPremium: true });
		});

		it('returns invalid when no username', async () => {
			vi.mocked(getAllDebridUser).mockResolvedValue({} as any);

			const result = await validateAllDebridApiKey('bad-key');

			expect(result).toEqual({ valid: false });
		});

		it('returns invalid on error', async () => {
			vi.mocked(getAllDebridUser).mockRejectedValue(new Error('fail'));

			const result = await validateAllDebridApiKey('bad-key');

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

			handleApiError('err', res, 'Custom error');

			expect(res._getData()).toEqual({ error: 'Custom error' });
			consoleSpy.mockRestore();
		});
	});

	describe('encryptApiKey / decryptApiKey', () => {
		it('returns the same key (passthrough)', () => {
			const key = 'my-secret-api-key';
			expect(encryptApiKey(key)).toBe(key);
			expect(decryptApiKey(key)).toBe(key);
		});

		it('roundtrips correctly', () => {
			const key = 'test-key-123';
			expect(decryptApiKey(encryptApiKey(key))).toBe(key);
		});
	});
});
