import { createMockRequest, createMockResponse } from '@/test/utils/api';
import crypto from 'crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/torrin', () => ({
	getTorrinUser: vi.fn(),
}));

import { getTorrinUser } from '@/services/torrin';
import {
	generateTorrinUserId,
	handleApiError,
	validateMethod,
	validateTorrinApiKey,
	validateTorrinCreds,
} from './torrinCastApiHelpers';

const originalSalt = process.env.DMMCAST_SALT;
const testSalt = 'test-tr-salt';

describe('torrinCastApiHelpers', () => {
	beforeEach(() => {
		process.env.DMMCAST_SALT = testSalt;
		vi.mocked(getTorrinUser).mockReset();
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

	describe('validateTorrinCreds', () => {
		it('returns creds from query', () => {
			const req = createMockRequest({
				query: { baseUrl: 'https://tr.test', apiKey: 'tr-key' },
			});
			const res = createMockResponse();
			expect(validateTorrinCreds(req, res)).toEqual({
				baseUrl: 'https://tr.test',
				apiKey: 'tr-key',
			});
		});

		it('returns creds from body', () => {
			const req = createMockRequest({
				body: { baseUrl: 'https://tr.test', apiKey: 'body-key' },
			});
			const res = createMockResponse();
			expect(validateTorrinCreds(req, res)).toEqual({
				baseUrl: 'https://tr.test',
				apiKey: 'body-key',
			});
		});

		it('returns null and sets 401 when baseUrl is missing', () => {
			const req = createMockRequest({ query: { apiKey: 'tr-key' } });
			const res = createMockResponse();
			expect(validateTorrinCreds(req, res)).toBeNull();
			expect(res._getStatusCode()).toBe(401);
		});

		it('returns null and sets 401 when apiKey is missing', () => {
			const req = createMockRequest({ query: { baseUrl: 'https://tr.test' } });
			const res = createMockResponse();
			expect(validateTorrinCreds(req, res)).toBeNull();
			expect(res._getStatusCode()).toBe(401);
		});
	});

	describe('generateTorrinUserId', () => {
		it('generates a deterministic id namespaced by instance + identity', async () => {
			vi.mocked(getTorrinUser).mockResolvedValue({
				email: 'user@example.com',
			} as any);

			const result = await generateTorrinUserId('https://tr.test/', 'tr-key');

			expect(getTorrinUser).toHaveBeenCalledWith('https://tr.test/', 'tr-key');
			const expected = crypto
				.createHmac('sha256', testSalt)
				.update('torrin:https://tr.test:user@example.com')
				.digest('base64url')
				.slice(0, 12);
			expect(result).toBe(expected);
		});

		it('falls back to username then id for identity', async () => {
			vi.mocked(getTorrinUser).mockResolvedValue({ username: 'bob' } as any);
			const result = await generateTorrinUserId('https://tr.test', 'tr-key');
			const expected = crypto
				.createHmac('sha256', testSalt)
				.update('torrin:https://tr.test:bob')
				.digest('base64url')
				.slice(0, 12);
			expect(result).toBe(expected);
		});

		it('throws when DMMCAST_SALT is missing', async () => {
			delete process.env.DMMCAST_SALT;
			vi.mocked(getTorrinUser).mockResolvedValue({ email: 'user@example.com' } as any);
			await expect(generateTorrinUserId('https://tr.test', 'key')).rejects.toThrow(
				'Failed to generate Torrin user ID'
			);
		});

		it('throws when getTorrinUser rejects', async () => {
			vi.mocked(getTorrinUser).mockRejectedValue(new Error('API error'));
			await expect(generateTorrinUserId('https://tr.test', 'key')).rejects.toThrow(
				'Failed to generate Torrin user ID'
			);
		});
	});

	describe('validateTorrinApiKey', () => {
		it('returns valid with email for valid creds', async () => {
			vi.mocked(getTorrinUser).mockResolvedValue({ email: 'user@tr.com' } as any);
			const result = await validateTorrinApiKey('https://tr.test', 'valid-key');
			expect(result).toEqual({ valid: true, email: 'user@tr.com' });
		});

		it('returns invalid when identity is missing', async () => {
			vi.mocked(getTorrinUser).mockResolvedValue({} as any);
			const result = await validateTorrinApiKey('https://tr.test', 'bad-key');
			expect(result).toEqual({ valid: false });
		});

		it('returns invalid on error', async () => {
			vi.mocked(getTorrinUser).mockRejectedValue(new Error('fail'));
			const result = await validateTorrinApiKey('https://tr.test', 'bad-key');
			expect(result).toEqual({ valid: false });
		});
	});

	describe('handleApiError', () => {
		it('sends 500 with default message', () => {
			const res = createMockResponse();
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			handleApiError(new Error('boom'), res);

			expect(res._getStatusCode()).toBe(500);
			expect(res._getData()).toEqual({ error: 'Internal Server Error: boom' });
			consoleSpy.mockRestore();
		});

		it('sends 500 with custom message', () => {
			const res = createMockResponse();
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			handleApiError('err', res, 'Custom Torrin error');

			expect(res._getData()).toEqual({ error: 'Custom Torrin error' });
			consoleSpy.mockRestore();
		});
	});
});
