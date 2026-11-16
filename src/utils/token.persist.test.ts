import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PAIR = { token: 'abc-1800000000', hash: 'sig' };
const KEY = 'dmm:availabilityToken';

// A fresh module copy is what a reload or a second tab starts with: empty memory.
async function freshPage() {
	vi.resetModules();
	return import('./token');
}

function mockChallenge() {
	const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => PAIR }));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('availability token across reloads and tabs', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		localStorage.clear();
	});

	it('reuses a token minted before a reload instead of checking again', async () => {
		const fetchMock = mockChallenge();
		await (await freshPage()).generateTokenAndHash();

		const [token, hash] = await (await freshPage()).generateTokenAndHash();

		expect([token, hash]).toEqual([PAIR.token, PAIR.hash]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('mints again once the stored token is past its reuse window', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_800_000_000_000));
		const fetchMock = mockChallenge();
		const first = await freshPage();
		await first.generateTokenAndHash();

		vi.setSystemTime(new Date(1_800_000_000_000 + first.TOKEN_REUSE_MS + 1));
		await (await freshPage()).generateTokenAndHash();

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('ignores junk and a stored expiry beyond the reuse window', async () => {
		const fetchMock = mockChallenge();
		localStorage.setItem(KEY, '{not json');
		await (await freshPage()).generateTokenAndHash();
		localStorage.setItem(
			KEY,
			JSON.stringify({ token: 'old', hash: 'old', expiresAt: Date.now() + 86_400_000 })
		);
		const [token] = await (await freshPage()).generateTokenAndHash();

		expect(token).toBe(PAIR.token);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('still works when storage throws', async () => {
		const fetchMock = mockChallenge();
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		const page = await freshPage();

		await page.generateTokenAndHash();
		await page.generateTokenAndHash();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		vi.restoreAllMocks();
	});
});
