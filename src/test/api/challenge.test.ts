import handler from '@/pages/api/challenge';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { validateProblemToken } from '@/utils/problemToken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-problem-secret-0123456789';

describe('GET /api/challenge', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv, DMM_PROBLEM_SECRET: SECRET };
		delete process.env.REDIS_URL;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('mints a pair its own validator accepts', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const body = res._getData() as { token: string; hash: string };
		expect(validateProblemToken(body.token, body.hash)).toBe(true);
	});

	it('never returns the same token twice', async () => {
		const first = createMockResponse();
		const second = createMockResponse();

		await handler(createMockRequest({ method: 'GET' }), first);
		await handler(createMockRequest({ method: 'GET' }), second);

		const a = first._getData() as { token: string };
		const b = second._getData() as { token: string };
		expect(a.token).not.toBe(b.token);
	});

	it('refuses to be cached', async () => {
		const res = createMockResponse();

		await handler(createMockRequest({ method: 'GET' }), res);

		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
	});

	it('rejects non-GET methods', async () => {
		const res = createMockResponse();

		await handler(createMockRequest({ method: 'POST' }), res);

		expect(res.status).toHaveBeenCalledWith(405);
	});

	// Fails closed: an unset secret must be visibly broken, not quietly minting
	// tokens the validator cannot verify.
	it('fails closed when the signing secret is unset', async () => {
		delete process.env.DMM_PROBLEM_SECRET;
		const res = createMockResponse();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		await handler(createMockRequest({ method: 'GET' }), res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});
