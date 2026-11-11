import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTokenAndHash, resetTokenCache } from './token';
import { solveTurnstile } from './turnstileClient';

vi.mock('./turnstileClient', () => ({ solveTurnstile: vi.fn(async () => 'cf-answer') }));

const PAIR = { token: 'abc-1800000000', hash: 'sig' };

describe('generateTokenAndHash with the browser check on', () => {
	beforeEach(() => resetTokenCache());
	afterEach(() => {
		vi.unstubAllGlobals();
		resetTokenCache();
	});

	it('runs Turnstile when the server asks, then sends the answer', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ turnstile: '0xSITE' }, { status: 401 }))
			.mockResolvedValueOnce(Response.json(PAIR));
		vi.stubGlobal('fetch', fetchMock);

		expect(await generateTokenAndHash()).toEqual([PAIR.token, PAIR.hash]);
		expect(solveTurnstile).toHaveBeenCalledWith('0xSITE');
		expect(fetchMock.mock.calls[1]).toEqual([
			'/api/challenge',
			{ headers: { 'x-turnstile-token': 'cf-answer' } },
		]);
	});

	it('skips the 401 round trip on later mints', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ turnstile: '0xSITE' }, { status: 401 }))
			.mockImplementation(async () => Response.json(PAIR));
		vi.stubGlobal('fetch', fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_800_000_000_000));
		await generateTokenAndHash();
		vi.setSystemTime(new Date(1_800_000_000_000 + 26 * 60_000)); // past the reuse window
		await generateTokenAndHash();
		vi.useRealTimers();

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(fetchMock.mock.calls[2][1]).toEqual({
			headers: { 'x-turnstile-token': 'cf-answer' },
		});
	});

	it('fails the mint, without caching, when the check is refused', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ turnstile: '0xSITE' }, { status: 401 }))
				.mockResolvedValueOnce(Response.json({ turnstile: '0xSITE' }, { status: 403 }))
		);
		await expect(generateTokenAndHash()).rejects.toThrow(/403/);
	});
});
