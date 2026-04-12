import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	extractToken,
	generateLegacyUserId,
	generateUserId,
	validateToken,
} from './castApiHelpers';

vi.mock('@/services/realDebrid', () => ({
	getCurrentUser: vi.fn(),
}));

import { getCurrentUser } from '@/services/realDebrid';

const originalSalt = process.env.DMMCAST_SALT;
const testSalt = 'test-cast-salt';

describe('castApiHelpers', () => {
	beforeEach(() => {
		process.env.DMMCAST_SALT = testSalt;
		vi.mocked(getCurrentUser).mockReset();
	});

	afterAll(() => {
		process.env.DMMCAST_SALT = originalSalt;
	});

	it('generates deterministic user id through the shared RealDebrid client', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue({ username: 'rate-limit-user' } as any);

		const result = await generateUserId('token-123');

		expect(getCurrentUser).toHaveBeenCalledWith('token-123');
		const expected = crypto
			.createHmac('sha256', testSalt)
			.update('rate-limit-user')
			.digest('base64url')
			.slice(0, 12);
		expect(result).toBe(expected);
	});

	it('generates legacy user id via the shared RealDebrid client', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue({ username: 'legacy-user' } as any);

		const result = await generateLegacyUserId('legacy-token');

		expect(getCurrentUser).toHaveBeenCalledWith('legacy-token');
		const expected = crypto
			.createHash('sha256')
			.update('legacy-user' + testSalt)
			.digest('base64')
			.replace(/\+/g, 'a')
			.replace(/\//g, 'b')
			.replace(/=/g, '')
			.slice(0, 5);
		expect(result).toBe(expected);
	});
});

function mockReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
	return {
		query: {},
		body: {},
		headers: {},
		...overrides,
	} as unknown as NextApiRequest;
}

function mockRes(): NextApiResponse {
	const res = {
		status: vi.fn().mockReturnThis(),
		json: vi.fn().mockReturnThis(),
	};
	return res as unknown as NextApiResponse;
}

describe('extractToken', () => {
	it('returns token from Authorization Bearer header', () => {
		const req = mockReq({ headers: { authorization: 'Bearer mytoken123' } });
		expect(extractToken(req)).toBe('mytoken123');
	});

	it('falls back to query param when no header', () => {
		const req = mockReq({ query: { token: 'querytoken' } });
		expect(extractToken(req)).toBe('querytoken');
	});

	it('falls back to body token when no header or query', () => {
		const req = mockReq({ body: { token: 'bodytoken' } });
		expect(extractToken(req)).toBe('bodytoken');
	});

	it('prefers header over query and body', () => {
		const req = mockReq({
			headers: { authorization: 'Bearer headertoken' },
			query: { token: 'querytoken' },
			body: { token: 'bodytoken' },
		});
		expect(extractToken(req)).toBe('headertoken');
	});

	it('returns null when no token anywhere', () => {
		const req = mockReq();
		expect(extractToken(req)).toBeNull();
	});

	it('returns null for malformed Authorization header (no Bearer prefix)', () => {
		const req = mockReq({ headers: { authorization: 'Basic sometoken' } });
		expect(extractToken(req)).toBeNull();
	});

	it('returns null for empty Bearer token', () => {
		const req = mockReq({ headers: { authorization: 'Bearer ' } });
		expect(extractToken(req)).toBeNull();
	});
});

describe('validateToken', () => {
	it('returns token from Authorization header', () => {
		const req = mockReq({ headers: { authorization: 'Bearer validtoken' } });
		const res = mockRes();
		expect(validateToken(req, res)).toBe('validtoken');
		expect(res.status).not.toHaveBeenCalled();
	});

	it('returns 401 when no token', () => {
		const req = mockReq();
		const res = mockRes();
		expect(validateToken(req, res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or missing token' });
	});
});
