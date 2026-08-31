import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateTokenAndHash, resetTokenCache } from './token';

const PAIR = { token: 'abc123-1800000000', hash: 'signature-one' };

function mockChallenge(payload: unknown, ok = true, status = 200) {
	const fetchMock = vi.fn(async () => ({
		ok,
		status,
		json: async () => payload,
	})) as unknown as typeof fetch;
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('generateTokenAndHash', () => {
	beforeEach(() => {
		resetTokenCache();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		resetTokenCache();
	});

	it('returns the pair minted by the server', async () => {
		mockChallenge(PAIR);

		const [token, hash] = await generateTokenAndHash();

		expect(token).toBe(PAIR.token);
		expect(hash).toBe(PAIR.hash);
	});

	it('asks the server, never signing locally', async () => {
		const fetchMock = mockChallenge(PAIR);

		await generateTokenAndHash();

		expect(fetchMock).toHaveBeenCalledWith('/api/challenge');
	});

	// The sweep mints once per row per service. Re-fetching each time would put a
	// season page into the endpoint's rate limit and, before this rewrite, cost a
	// Real-Debrid `getTimeISO` call every time.
	it('reuses a cached token instead of re-minting per call', async () => {
		const fetchMock = mockChallenge(PAIR);

		await generateTokenAndHash();
		await generateTokenAndHash();
		await generateTokenAndHash();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('shares one request between concurrent callers', async () => {
		const fetchMock = mockChallenge(PAIR);

		const results = await Promise.all([
			generateTokenAndHash(),
			generateTokenAndHash(),
			generateTokenAndHash(),
		]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(results.every(([token]) => token === PAIR.token)).toBe(true);
	});

	it('re-mints once the cached token nears expiry', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_800_000_000_000));
		const fetchMock = mockChallenge(PAIR);

		await generateTokenAndHash();
		vi.setSystemTime(new Date(1_800_000_000_000 + 2 * 60_000 + 1));
		await generateTokenAndHash();

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	// The server refuses a token older than 5 minutes. Whatever this cache hands
	// out has to still be comfortably inside that when the request lands, so the
	// reuse window is checked directly rather than left implicit.
	it('never hands out a token with less than three minutes of server validity', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_800_000_000_000));
		mockChallenge(PAIR);

		await generateTokenAndHash();

		// One millisecond before the cache would refresh: the oldest a reused
		// token can be.
		vi.setSystemTime(new Date(1_800_000_000_000 + 2 * 60_000 - 1));
		const [token] = await generateTokenAndHash();

		expect(token).toBe(PAIR.token);
		const remainingMs = 5 * 60_000 - (2 * 60_000 - 1);
		expect(remainingMs).toBeGreaterThanOrEqual(3 * 60_000);
	});

	it('does not cache a failed mint', async () => {
		const fetchMock = mockChallenge(null, false, 500);

		await expect(generateTokenAndHash()).rejects.toThrow(
			'Failed to obtain an availability token: 500'
		);
		await expect(generateTokenAndHash()).rejects.toThrow();

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('rejects a malformed response rather than sending junk to the server', async () => {
		mockChallenge({ token: 'abc-123' });

		await expect(generateTokenAndHash()).rejects.toThrow(
			'Malformed availability token response'
		);
	});

	it('re-mints after the cache is reset', async () => {
		const fetchMock = mockChallenge(PAIR);

		await generateTokenAndHash();
		resetTokenCache();
		await generateTokenAndHash();

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
