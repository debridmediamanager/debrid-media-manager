import libraryHandler from '@/pages/api/library/mediainfo';
import sponsorHandler from '@/pages/api/sponsor/mediainfo';
import torrentsHandler from '@/pages/api/torrents/mediainfo';
import { RATE_LIMIT_CONFIGS } from '@/services/rateLimit/configs';
import { repository } from '@/services/repository';
import refused from '@/test/fixtures/library/native-app-mediainfo-refused-2026-11-13.json';
import partialPack from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0-partial-pack.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { verifyIdentity } from '@/utils/browserStateIdentity';
import { storedProbes, TorrentSnapshot, toStoredSnapshot } from '@/utils/torrentSnapshot';
import type { NextApiHandler } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// the real per-IP limiter (in memory), not the pass-through every other test gets
vi.unmock('@/services/rateLimit/withRateLimit');
vi.stubEnv('REDIS_URL', '');
vi.stubEnv('RATE_LIMIT_WHITELIST_IPS', '');
vi.mock('@/services/repository');
vi.mock('@/utils/browserStateIdentity');

// The DMM Mobile app's request as production saw it on 2026-11-13: https behind the
// proxy, no Sec-Fetch-Site, no Origin.
const NATIVE = { ...refused.request.headers, 'x-forwarded-proto': 'https' };
const PAGE_ONLY = refused.responses['GET /api/torrents/mediainfo?hash='];
// the identity the app syncs /api/browser-state with
const GOOD = { service: 'tb', apiKey: 'tb-good' };
const BAD = { service: 'ad', apiKey: 'ad-refused' };
// A real zurg post, stored the way the snapshot route stores it.
const stored = toStoredSnapshot(TorrentSnapshot.parse(partialPack));
const HASH = stored.Hash;

let ip = 0;
async function call(
	handler: NextApiHandler,
	body: Record<string, unknown> | undefined,
	headers: Record<string, string>,
	{ method = 'POST', query = {}, from = `198.51.100.${++ip}` } = {}
) {
	const req = createMockRequest({
		method,
		body,
		query,
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
	vi.mocked(repository.getSnapshotsByHashes).mockResolvedValue([
		{ hash: HASH, payload: stored },
	] as never);
	vi.mocked(repository.getContributedProbes).mockResolvedValue([]);
	vi.mocked(repository.getLatestTorrentSnapshot).mockResolvedValue({
		hash: HASH,
		payload: stored,
	} as never);
});

describe('/api/library/mediainfo from the DMM Mobile app', () => {
	it("answers an app that proves a provider login with each file's probe, path and size", async () => {
		const res = await call(libraryHandler, { hashes: [HASH], identity: GOOD }, NATIVE);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ releases: { [HASH]: { files: storedProbes(stored) } } });
		expect(vi.mocked(verifyIdentity).mock.calls[0][0]).toEqual(GOOD);
	});

	it('still refuses a native caller with no login, as the page route did in production', async () => {
		const res = await call(libraryHandler, { hashes: [HASH] }, NATIVE);

		expect(res._getStatusCode()).toBe(PAGE_ONLY.status);
		expect(res._getData()).toEqual(PAGE_ONLY.body);
		expect(verifyIdentity).not.toHaveBeenCalled();
		expect(repository.getSnapshotsByHashes).not.toHaveBeenCalled();
	});

	it('still refuses a native caller whose login the provider refuses', async () => {
		const res = await call(libraryHandler, { hashes: [HASH], identity: BAD }, NATIVE);

		expect(res._getStatusCode()).toBe(PAGE_ONLY.status);
		expect(res._getData()).toEqual(PAGE_ONLY.body);
		expect(repository.getSnapshotsByHashes).not.toHaveBeenCalled();
	});

	it('refuses another site even when it sends a login', async () => {
		for (const headers of [
			{ ...NATIVE, 'sec-fetch-site': 'cross-site' },
			{ ...NATIVE, origin: 'https://evil.example' },
		]) {
			const res = await call(libraryHandler, { hashes: [HASH], identity: GOOD }, headers);
			expect(res._getStatusCode()).toBe(403);
		}
		expect(verifyIdentity).not.toHaveBeenCalled();
	});

	it("serves DMM's own pages without asking any provider", async () => {
		const res = await call(
			libraryHandler,
			{ hashes: [HASH] },
			{ ...NATIVE, 'sec-fetch-site': 'same-origin' }
		);

		expect(res._getStatusCode()).toBe(200);
		expect(verifyIdentity).not.toHaveBeenCalled();
	});

	it("holds the sponsor route's batch rules: 1-100 info hashes, POST only", async () => {
		const tooMany = Array.from({ length: 101 }, (_, n) => n.toString(16).padStart(40, '0'));
		for (const hashes of [[], tooMany, ['not-a-hash']]) {
			const res = await call(libraryHandler, { hashes, identity: GOOD }, NATIVE);
			expect(res._getStatusCode()).toBe(400);
		}
		const get = await call(libraryHandler, undefined, NATIVE, { method: 'GET' });
		expect(get._getStatusCode()).toBe(405);
	});
});

describe('the routes that were there before', () => {
	it("GET /api/torrents/mediainfo still serves DMM's pages only", async () => {
		const native = await call(torrentsHandler, undefined, NATIVE, {
			method: 'GET',
			query: { hash: HASH },
		});
		expect(native._getStatusCode()).toBe(PAGE_ONLY.status);
		expect(native._getData()).toEqual(PAGE_ONLY.body);

		const page = await call(
			torrentsHandler,
			undefined,
			{ ...NATIVE, 'sec-fetch-site': 'same-origin' },
			{ method: 'GET', query: { hash: HASH } }
		);
		expect(page._getStatusCode()).toBe(200);
		expect(verifyIdentity).not.toHaveBeenCalled();
	});

	it('/api/sponsor/mediainfo still wants a sponsor key, a login is not one', async () => {
		const expected = refused.responses['POST /api/sponsor/mediainfo'];
		const res = await call(sponsorHandler, { hashes: [HASH], identity: GOOD }, NATIVE);

		expect(res._getStatusCode()).toBe(expected.status);
		expect(res._getData()).toEqual(expected.body);
		expect(verifyIdentity).not.toHaveBeenCalled();
	});
});

describe('per-IP limits', () => {
	it('leave the existing budgets as they were', () => {
		expect(RATE_LIMIT_CONFIGS.torrents).toMatchObject({ rateLimit: 1, windowSeconds: 2 });
		expect(RATE_LIMIT_CONFIGS.sponsorMediaInfo).toMatchObject({
			rateLimit: 25,
			windowSeconds: 60,
		});
		expect(RATE_LIMIT_CONFIGS.libraryMediaInfo).toMatchObject({
			rateLimit: 10,
			windowSeconds: 60,
		});
	});

	// The limit comes first, so a caller spends at most one provider check per allowed call.
	it('hold an app to 10 calls a minute per address', async () => {
		const from = '203.0.113.77';
		const statuses: number[] = [];
		for (let n = 0; n <= 10; n++) {
			const res = await call(libraryHandler, { hashes: [HASH], identity: GOOD }, NATIVE, {
				from,
			});
			statuses.push(res._getStatusCode());
		}

		expect(statuses).toEqual([...Array(10).fill(200), 429]);
		expect(verifyIdentity).toHaveBeenCalledTimes(10);
	});
});
