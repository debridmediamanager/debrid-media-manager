import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeSponsorClaims, SPONSOR_TOKEN_KEY, useSponsor } from './useSponsor';

function makeToken(claims: object): string {
	const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
	return `${body}.signature-is-not-checked-client-side`;
}

const ACTIVE = {
	shortId: 'ZP1M',
	githubUsername: 'someone',
	sources: ['github'],
	keyVersion: 1,
	exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
};

describe('decodeSponsorClaims', () => {
	it('decodes a well-formed token', () => {
		expect(decodeSponsorClaims(makeToken(ACTIVE))?.githubUsername).toBe('someone');
	});

	it('rejects an expired token', () => {
		expect(decodeSponsorClaims(makeToken({ ...ACTIVE, exp: Date.now() - 1 }))).toBeNull();
	});

	it('rejects malformed input', () => {
		expect(decodeSponsorClaims(null)).toBeNull();
		expect(decodeSponsorClaims('nodot')).toBeNull();
		expect(decodeSponsorClaims('!!!.sig')).toBeNull();
	});

	it('rejects a payload with no sponsorship id', () => {
		expect(decodeSponsorClaims(makeToken({ exp: ACTIVE.exp }))).toBeNull();
	});
});

describe('useSponsor', () => {
	beforeEach(() => {
		window.localStorage.clear();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reports no sponsorship when nothing is stored', () => {
		const { result } = renderHook(() => useSponsor());
		expect(result.current.isSponsor).toBe(false);
		expect(result.current.sources).toEqual([]);
	});

	it('reports a sponsorship from the stored token', async () => {
		window.localStorage.setItem(SPONSOR_TOKEN_KEY, JSON.stringify(makeToken(ACTIVE)));
		const { result } = renderHook(() => useSponsor());
		await waitFor(() => expect(result.current.isSponsor).toBe(true));
		expect(result.current.githubUsername).toBe('someone');
		expect(result.current.sources).toEqual(['github']);
	});

	it('does not refresh a token that is nowhere near expiry', async () => {
		window.localStorage.setItem(SPONSOR_TOKEN_KEY, JSON.stringify(makeToken(ACTIVE)));
		const { result } = renderHook(() => useSponsor());
		await waitFor(() => expect(result.current.isSponsor).toBe(true));
		expect(fetch).not.toHaveBeenCalled();
	});

	// A lapsed sponsorship is only ever noticed by asking the server, so the
	// refresh has to actually fire inside the threshold.
	it('refreshes a token inside its last day and drops it once lapsed', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			json: async () => ({ isSponsor: false }),
		});
		const nearlyExpired = { ...ACTIVE, exp: Date.now() + 60_000 };
		window.localStorage.setItem(SPONSOR_TOKEN_KEY, JSON.stringify(makeToken(nearlyExpired)));

		const { result } = renderHook(() => useSponsor());
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		await waitFor(() => expect(result.current.isSponsor).toBe(false));
	});

	it('disconnect clears the stored token', async () => {
		window.localStorage.setItem(SPONSOR_TOKEN_KEY, JSON.stringify(makeToken(ACTIVE)));
		const { result } = renderHook(() => useSponsor());
		await waitFor(() => expect(result.current.isSponsor).toBe(true));

		result.current.disconnect();
		await waitFor(() => expect(result.current.isSponsor).toBe(false));
		expect(window.localStorage.getItem(SPONSOR_TOKEN_KEY)).toBeNull();
	});
});

describe('useSponsor.link', () => {
	beforeEach(() => {
		window.localStorage.clear();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('stores the token returned for a good key', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			json: async () => ({ isSponsor: true, token: makeToken(ACTIVE), expiresIn: 604800 }),
		});
		const { result } = renderHook(() => useSponsor());

		await waitFor(async () => expect((await result.current.link('k')).ok).toBe(true));
		await waitFor(() => expect(result.current.isSponsor).toBe(true));
	});

	it('surfaces the server error for a bad key and stores nothing', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			json: async () => ({ isSponsor: false, error: 'Unknown API key' }),
		});
		const { result } = renderHook(() => useSponsor());

		const outcome = await result.current.link('nope');
		expect(outcome).toEqual({ ok: false, error: 'Unknown API key' });
		expect(window.localStorage.getItem(SPONSOR_TOKEN_KEY)).toBeNull();
	});

	it('reports a network failure rather than throwing', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
		const { result } = renderHook(() => useSponsor());

		expect(await result.current.link('k')).toEqual({
			ok: false,
			error: 'Could not reach the server',
		});
	});
});
