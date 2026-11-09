import handler from '@/pages/api/browser-state';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { verifyIdentity } from '@/utils/browserStateIdentity';
import { MAX_STATE_BYTES } from '@/utils/browserStateKeys';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/browserStateIdentity');

vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (wrapped: unknown) => wrapped };
});

const GOOD = { service: 'tb', apiKey: 'tb-good' };
const BAD = { service: 'ad', apiKey: 'ad-refused' };
const STATE = { 'tb:apiKey': 'tb-good', 'rd:refreshToken': 'RT', 'settings:x': 'true' };

/** `_getData` is whatever was handed to `json` or `send`. */
function json(res: ReturnType<typeof createMockResponse>): any {
	return res._getData() as any;
}

async function call(method: string, body?: unknown, headers: Record<string, string> = {}) {
	const req = createMockRequest({ method, body, headers });
	const res = createMockResponse();
	await handler(req as never, res as never);
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(verifyIdentity).mockImplementation(async (identity) =>
		'apiKey' in identity && identity.apiKey === 'tb-good' ? 'tbUser000001' : null
	);
	vi.mocked(repository.saveBrowserState).mockResolvedValue(undefined);
	vi.mocked(repository.deleteBrowserState).mockResolvedValue(true);
	vi.mocked(repository.getBrowserState).mockResolvedValue(null);
});

describe('/api/browser-state', () => {
	it('refuses other methods', async () => {
		const res = await call('GET');

		expect(res._getStatusCode()).toBe(405);
	});

	// The answer is a bag of credentials: another site's script must not be able
	// to ask for it, even with a login it somehow holds.
	it('refuses a cross-site caller before asking any provider', async () => {
		const res = await call('POST', { identity: GOOD }, { 'sec-fetch-site': 'cross-site' });

		expect(res._getStatusCode()).toBe(403);
		expect(verifyIdentity).not.toHaveBeenCalled();
		expect(repository.getBrowserState).not.toHaveBeenCalled();
	});

	// The DMM Library app (dmm-mobile) syncs through this route on every login. A native
	// client sends neither Sec-Fetch-Site nor Origin; a browser sends at least one.
	it('serves a native app over https, which sends no browser headers', async () => {
		const res = await call('POST', { identity: GOOD }, { 'x-forwarded-proto': 'https' });

		expect(res._getStatusCode()).toBe(204);
		expect(vi.mocked(verifyIdentity).mock.calls[0][0]).toEqual(GOOD);
	});

	it('refuses another site over https even when its browser sends no Sec-Fetch-Site', async () => {
		const res = await call(
			'PUT',
			{ identities: [GOOD], state: STATE },
			{ 'x-forwarded-proto': 'https', origin: 'https://evil.example' }
		);

		expect(res._getStatusCode()).toBe(403);
		expect(verifyIdentity).not.toHaveBeenCalled();
	});

	describe('PUT', () => {
		it('refuses when no login verifies', async () => {
			const res = await call('PUT', { identities: [BAD], state: STATE });

			expect(res._getStatusCode()).toBe(401);
			expect(repository.saveBrowserState).not.toHaveBeenCalled();
		});

		// Only named keys are stored, so a page bug cannot sync per-browser state
		// and a caller cannot use the table as free storage.
		it('refuses a key that is not synced, naming it, and stores nothing', async () => {
			const res = await call('PUT', {
				identities: [GOOD],
				state: { ...STATE, 'rd:castToken': 'x' },
			});

			expect(res._getStatusCode()).toBe(400);
			expect(json(res).error).toContain('rd:castToken');
			expect(repository.saveBrowserState).not.toHaveBeenCalled();
			expect(verifyIdentity).not.toHaveBeenCalled();
		});

		it('refuses a value that is not a string', async () => {
			const res = await call('PUT', { identities: [GOOD], state: { 'settings:x': true } });

			expect(res._getStatusCode()).toBe(400);
			expect(repository.saveBrowserState).not.toHaveBeenCalled();
		});

		it('refuses a state over the size limit', async () => {
			const res = await call('PUT', {
				identities: [GOOD],
				state: { 'settings:big': 'x'.repeat(MAX_STATE_BYTES) },
			});

			expect(res._getStatusCode()).toBe(413);
			expect(repository.saveBrowserState).not.toHaveBeenCalled();
		});

		it('saves one row per verified login and skips the refused one', async () => {
			const res = await call('PUT', { identities: [GOOD, BAD], state: STATE });

			expect(res._getStatusCode()).toBe(200);
			expect(json(res)).toEqual({ saved: 1 });
			expect(repository.saveBrowserState).toHaveBeenCalledTimes(1);
			expect(repository.saveBrowserState).toHaveBeenCalledWith(
				'tb',
				'tbUser000001',
				JSON.stringify(STATE)
			);
		});

		it('saves once when two logins are the same account', async () => {
			const res = await call('PUT', { identities: [GOOD, { ...GOOD }], state: STATE });

			expect(json(res)).toEqual({ saved: 1 });
			expect(repository.saveBrowserState).toHaveBeenCalledTimes(1);
		});
	});

	describe('POST', () => {
		it('refuses a login the provider does not accept', async () => {
			const res = await call('POST', { identity: BAD });

			expect(res._getStatusCode()).toBe(401);
			expect(repository.getBrowserState).not.toHaveBeenCalled();
		});

		it('returns the stored state parsed, with an ISO timestamp', async () => {
			vi.mocked(repository.getBrowserState).mockResolvedValue({
				state: JSON.stringify(STATE),
				updatedAt: new Date('2026-11-01T12:00:00Z'),
			});

			const res = await call('POST', { identity: GOOD });

			expect(res._getStatusCode()).toBe(200);
			expect(repository.getBrowserState).toHaveBeenCalledWith('tb', 'tbUser000001');
			expect(json(res)).toEqual({ state: STATE, updatedAt: '2026-11-01T12:00:00.000Z' });
		});

		it('answers 204 with no body when nothing is stored', async () => {
			const res = await call('POST', { identity: GOOD });

			expect(res._getStatusCode()).toBe(204);
			expect(res._getData()).toBeUndefined();
		});
	});

	describe('DELETE', () => {
		it('removes the rows of every verified login', async () => {
			const res = await call('DELETE', { identities: [GOOD, BAD] });

			expect(res._getStatusCode()).toBe(200);
			expect(json(res)).toEqual({ removed: 1 });
			expect(repository.deleteBrowserState).toHaveBeenCalledWith('tb', 'tbUser000001');
		});

		it('refuses when no login verifies', async () => {
			const res = await call('DELETE', { identities: [BAD] });

			expect(res._getStatusCode()).toBe(401);
			expect(repository.deleteBrowserState).not.toHaveBeenCalled();
		});
	});

	it.each([
		['PUT without identities', 'PUT', { state: STATE }],
		['PUT with empty identities', 'PUT', { identities: [], state: STATE }],
		['PUT with too many identities', 'PUT', { identities: Array(21).fill(GOOD), state: STATE }],
		['PUT with an array state', 'PUT', { identities: [GOOD], state: [] }],
		['PUT without state', 'PUT', { identities: [GOOD] }],
		['POST without identity', 'POST', {}],
		['POST with a string identity', 'POST', { identity: 'tb-good' }],
		['DELETE without identities', 'DELETE', {}],
		['DELETE with an object for identities', 'DELETE', { identities: GOOD }],
	])('refuses %s', async (_label, method, body) => {
		const res = await call(method, body);

		expect(res._getStatusCode()).toBe(400);
		expect(verifyIdentity).not.toHaveBeenCalled();
	});
});
