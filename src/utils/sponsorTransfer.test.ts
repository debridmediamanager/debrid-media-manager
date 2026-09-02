import { SPONSOR_TOKEN_KEY } from '@/hooks/useSponsor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebridUploaderJob } from './debridUploader';
import { createNzb2rdJob } from './nzb2rd';

/**
 * The two transfer paths that carry a sponsor perk: nzb2rd's priority tier and
 * the uploader's raised job ceiling. Both are decided server-side from this
 * header, so a client that forgets to send it silently downgrades every sponsor
 * — the same shape as the Real-Debrid cast bug, which shipped for exactly that
 * reason.
 */
function storeSponsorToken(): string {
	const claims = {
		shortId: 'ZP1M',
		githubUsername: 'someone',
		sources: ['github'],
		keyVersion: 1,
		exp: Date.now() + 3_600_000,
	};
	const token = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
	window.localStorage.setItem(SPONSOR_TOKEN_KEY, JSON.stringify(token));
	return token;
}

const okJson = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: async () => body });

describe('sponsor token on the transfer paths', () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		window.localStorage.clear();
	});

	it('sends the token to the usenet transfer route', async () => {
		const token = storeSponsorToken();
		const fetchMock = okJson({ id: 'job-1', status: 'pending' });
		vi.stubGlobal('fetch', fetchMock);

		await createNzb2rdJob({ id: 'rel-1', title: 'A', imdbId: 'tt1418646', rdKey: 'k' });

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/nzb2rd/jobs',
			expect.objectContaining({
				headers: expect.objectContaining({ 'x-dmm-sponsor': token }),
			})
		);
	});

	it('sends the token to the debrid transfer route', async () => {
		const token = storeSponsorToken();
		const fetchMock = okJson({ id: 'job-2', status: 'pending' });
		vi.stubGlobal('fetch', fetchMock);

		await createDebridUploaderJob({ hash: 'abc', imdbId: 'tt1418646', rdKey: 'k' } as never);

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/debrid-uploader/jobs',
			expect.objectContaining({
				headers: expect.objectContaining({ 'x-dmm-sponsor': token }),
			})
		);
	});

	it('sends no sponsor header for a non-sponsor', async () => {
		const fetchMock = okJson({ id: 'job-3', status: 'pending' });
		vi.stubGlobal('fetch', fetchMock);

		await createNzb2rdJob({ id: 'rel-1', title: 'A', imdbId: 'tt1418646', rdKey: 'k' });

		// Not merely absent-valued: the key must not be present at all, so the
		// service sees an ordinary submission.
		const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
		expect(headers).toEqual({ 'Content-Type': 'application/json' });
	});

	it('sends no sponsor header once the stored token has expired', async () => {
		const claims = {
			shortId: 'ZP1M',
			githubUsername: 'someone',
			sources: ['github'],
			keyVersion: 1,
			exp: Date.now() + 3_600_000,
		};
		const token = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
		// The useLocalStorage TTL envelope, already past its expiry.
		window.localStorage.setItem(
			SPONSOR_TOKEN_KEY,
			JSON.stringify({ value: token, expiry: Date.now() - 1 })
		);
		const fetchMock = okJson({ id: 'job-4', status: 'pending' });
		vi.stubGlobal('fetch', fetchMock);

		await createNzb2rdJob({ id: 'rel-1', title: 'A', imdbId: 'tt1418646', rdKey: 'k' });

		const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
		expect(headers).toEqual({ 'Content-Type': 'application/json' });
	});
});
