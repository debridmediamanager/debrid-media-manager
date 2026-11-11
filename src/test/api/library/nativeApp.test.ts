import identifiedHandler from '@/pages/api/library/identified';
import identifyHandler from '@/pages/api/library/identify';
import { identifyFilenames } from '@/services/contentIdentifier';
import { RATE_LIMIT_CONFIGS } from '@/services/rateLimit/configs';
import { repository } from '@/services/repository';
import refused from '@/test/fixtures/library/native-app-refused-2026-11-12.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { verifyIdentity } from '@/utils/browserStateIdentity';
import { createHash } from 'crypto';
import type { NextApiHandler } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// the real per-IP limiter (in memory), not the pass-through every other test gets
vi.unmock('@/services/rateLimit/withRateLimit');
vi.stubEnv('REDIS_URL', '');
vi.stubEnv('RATE_LIMIT_WHITELIST_IPS', '');
vi.mock('@/services/repository');
vi.mock('@/services/contentIdentifier', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/contentIdentifier')>()),
	identifyFilenames: vi.fn(),
}));
vi.mock('@/services/placement', () => ({ cachedSources: { find: vi.fn(), show: vi.fn() } }));
vi.mock('@/utils/browserStateIdentity');

// The DMM Mobile app's request as production saw it on 2026-11-12: https behind the
// proxy, no Sec-Fetch-Site, no Origin.
const NATIVE = { ...refused.request.headers, 'x-forwarded-proto': 'https' };
const ITEM = refused.request.body.items[0];
// the identity the app syncs /api/browser-state with
const GOOD = { service: 'tb', apiKey: 'tb-good' };
const BAD = { service: 'ad', apiKey: 'ad-refused' };
const STORED = {
	hash: ITEM.hash,
	titleKey: createHash('sha1').update(`auto3:${ITEM.filename}`).digest('hex'),
	filename: ITEM.filename,
	kind: 'movie',
	imdbId: 'tt2285752',
	title: 'Tears of Steel',
	year: 2012,
	score: 0.99,
	confident: true,
};
const NAMED = {
	results: [{ imdbId: 'tt2285752', title: 'Tears of Steel', year: 2012, kind: 'movie' }],
};

const routes: [string, NextApiHandler, unknown][] = [
	['/api/library/identify', identifyHandler, { ...NAMED, complete: true }],
	['/api/library/identified', identifiedHandler, NAMED],
];

let ip = 0;
async function call(
	handler: NextApiHandler,
	body: Record<string, unknown>,
	headers: Record<string, string>,
	from = `198.51.100.${++ip}`
) {
	const req = createMockRequest({
		method: 'POST',
		body,
		headers: { ...headers, 'x-real-ip': from },
	});
	const res = createMockResponse();
	await handler(req, res);
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(verifyIdentity).mockImplementation(async (identity) =>
		'apiKey' in identity && identity.apiKey === 'tb-good' ? 'tbUser000001' : null
	);
	vi.mocked(repository.getFilenameIdentifications).mockResolvedValue([STORED]);
	vi.mocked(repository.saveFilenameIdentifications).mockResolvedValue(1 as never);
	vi.mocked(repository.getHashTitleIds).mockResolvedValue(new Map());
});

describe.each(routes)('%s from the DMM Mobile app', (route, handler, named) => {
	const expected = refused.responses[route as keyof typeof refused.responses];

	it('names the library of an app that proves a provider login', async () => {
		const res = await call(handler, { items: [ITEM], identity: GOOD }, NATIVE);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual(named);
		expect(vi.mocked(verifyIdentity).mock.calls[0][0]).toEqual(GOOD);
		expect(identifyFilenames).not.toHaveBeenCalled();
	});

	it('still refuses a native caller with no login, as production did', async () => {
		const res = await call(handler, { items: [ITEM] }, NATIVE);

		expect(res._getStatusCode()).toBe(expected.status);
		expect(res._getData()).toEqual(expected.body);
		expect(verifyIdentity).not.toHaveBeenCalled();
		expect(repository.getFilenameIdentifications).not.toHaveBeenCalled();
	});

	it('still refuses a native caller whose login the provider refuses', async () => {
		const res = await call(handler, { items: [ITEM], identity: BAD }, NATIVE);

		expect(res._getStatusCode()).toBe(expected.status);
		expect(res._getData()).toEqual(expected.body);
		expect(repository.getFilenameIdentifications).not.toHaveBeenCalled();
	});

	it('refuses another site even when it sends a login', async () => {
		for (const headers of [
			{ ...NATIVE, 'sec-fetch-site': 'cross-site' },
			{ ...NATIVE, origin: 'https://evil.example' },
		]) {
			const res = await call(handler, { items: [ITEM], identity: GOOD }, headers);
			expect(res._getStatusCode()).toBe(403);
		}
		expect(verifyIdentity).not.toHaveBeenCalled();
	});

	it("serves DMM's own pages as before, without asking any provider", async () => {
		const res = await call(
			handler,
			{ items: [ITEM] },
			{ ...NATIVE, 'sec-fetch-site': 'same-origin' }
		);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual(named);
		expect(verifyIdentity).not.toHaveBeenCalled();
	});
});

describe('per-IP limits', () => {
	it('are the same budgets as before', () => {
		expect(RATE_LIMIT_CONFIGS.libraryIdentify).toMatchObject({
			rateLimit: 10,
			windowSeconds: 60,
		});
		expect(RATE_LIMIT_CONFIGS.libraryIdentified).toMatchObject({
			rateLimit: 5,
			windowSeconds: 60,
		});
	});

	// The limit comes first, so a caller spends at most one provider check per allowed call.
	it.each([
		['/api/library/identify', identifyHandler, 10],
		['/api/library/identified', identifiedHandler, 5],
	] as const)(
		'hold an app on %s to its calls a minute per address',
		async (_, handler, limit) => {
			const from = `203.0.113.${limit}`;
			const statuses: number[] = [];
			for (let n = 0; n <= limit; n++) {
				const res = await call(handler, { items: [ITEM], identity: GOOD }, NATIVE, from);
				statuses.push(res._getStatusCode());
			}

			expect(statuses).toEqual([...Array(limit).fill(200), 429]);
			expect(verifyIdentity).toHaveBeenCalledTimes(limit);
		}
	);
});
