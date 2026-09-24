import handler from '@/pages/api/requests';
import { repository } from '@/services/repository';
import { addHashToRd, alreadyOnRealDebrid } from '@/services/requestDelivery';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateUserId } from '@/utils/castApiHelpers';
import { torboxCachedHashesReusing as torboxCachedHashes } from '@/utils/torboxCache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/torboxCache', () => ({ __esModule: true, torboxCachedHashesReusing: vi.fn() }));
vi.mock('@/services/requestDelivery', () => ({
	__esModule: true,
	alreadyOnRealDebrid: vi.fn(async () => new Map()),
	addHashToRd: vi.fn(async () => true),
}));
vi.mock('@/utils/castApiHelpers', () => ({ __esModule: true, generateUserId: vi.fn() }));

const mockRepo = vi.mocked(repository);
const mockUserId = vi.mocked(generateUserId);

const HASH = '1ea32261cd04fc8633c6b30ca3d98213279d689f';

const row = (over: Record<string, unknown> = {}) => ({
	id: 'req-1',
	hash: HASH,
	imdbId: 'tt1234567',
	title: 'Some Release',
	mediaType: 'movie',
	status: 'open',
	requesterId: 'asker',
	fulfillerId: null,
	jobId: null,
	createdAt: new Date('2026-08-27T05:00:00Z'),
	...over,
});

const call = async (over: Record<string, unknown> = {}) => {
	const req = createMockRequest({
		method: 'GET',
		query: {},
		headers: { 'x-rd-access-token': 'tok' },
		...over,
	});
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

const statusOf = (res: any) => (res.status as any).mock.calls[0][0];
const bodyOf = (res: any) => (res.json as any).mock.calls[0][0];

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(alreadyOnRealDebrid).mockResolvedValue(new Map());
	vi.mocked(addHashToRd).mockResolvedValue(true);
	mockUserId.mockResolvedValue('asker');
	mockRepo.listOpenContentRequests = vi.fn().mockResolvedValue([row()]);
	mockRepo.listContentRequestsFor = vi.fn().mockResolvedValue([]);
	mockRepo.createContentRequest = vi.fn().mockResolvedValue(row());
});

describe('GET /api/requests?servable=1', () => {
	// The two releases from the recorded TorBox answer: only one is cached.
	const CACHED = '90a7b57357ed0f2ae65ca39336b3bd923684413e';
	const UNCACHED = 'abb28cb1dc25c1e2fa27aac9d1fe70d4c02be8f2';
	const servable = (over: Record<string, unknown> = {}) =>
		call({
			query: { servable: '1', ...over },
			headers: { 'x-rd-access-token': 'tok', 'x-tb-api-key': 'TB' },
		});

	beforeEach(() => {
		mockRepo.listOpenContentRequests = vi
			.fn()
			.mockResolvedValue([
				row({ id: 'old-uncached', hash: UNCACHED }),
				row({ id: 'newer-cached', hash: CACHED }),
			]);
		vi.mocked(torboxCachedHashes).mockResolvedValue(new Set([CACHED]));
	});

	// Oldest-first paging put a page of unsendable rows in front of every
	// fulfiller; nothing filed after 2026-09-15 had been reached by 09-24.
	it('lists only what TorBox can send, from across the whole board', async () => {
		const res = await servable();
		expect(statusOf(res)).toBe(200);
		expect(mockRepo.listOpenContentRequests).toHaveBeenCalledWith(3000, 0);
		expect(bodyOf(res).requests.map((r: any) => r.id)).toEqual(['newer-cached']);
		expect(bodyOf(res).requests[0].tbCached).toBe(true);
		expect(bodyOf(res).hasMore).toBe(false);
	});

	it('pages the filtered list, not the board', async () => {
		const res = await servable({ offset: '1' });
		expect(bodyOf(res).requests).toEqual([]);
	});

	it('needs a TorBox key', async () => {
		const res = await call({ query: { servable: '1' } });
		expect(statusOf(res)).toBe(400);
	});

	it('says so when TorBox gives no answer rather than showing an empty board', async () => {
		vi.mocked(torboxCachedHashes).mockResolvedValue(null);
		expect(statusOf(await servable())).toBe(503);
	});
});

describe('GET /api/requests', () => {
	// The board lists only open rows, so an asker whose request was sent, failed
	// or was on its way had nowhere to see it.
	it('lists the caller’s own requests in every state with ?mine=1', async () => {
		mockRepo.listContentRequestsFor = vi
			.fn()
			.mockResolvedValue([
				row({ id: 'a', status: 'claimed', jobId: 'job-1' }),
				row({ id: 'b', status: 'failed', error: 'uncached' }),
				row({ id: 'c', status: 'fulfilled', jobId: 'job-2' }),
			]);
		const res = await call({ query: { mine: '1' } });
		expect(statusOf(res)).toBe(200);
		expect(mockRepo.listContentRequestsFor).toHaveBeenCalledWith('asker', 100);
		expect(mockRepo.listOpenContentRequests).not.toHaveBeenCalled();
		expect(bodyOf(res).requests.map((r: any) => [r.status, r.error])).toEqual([
			['claimed', null],
			['failed', 'uncached'],
			['fulfilled', null],
		]);
	});

	it('refuses ?mine=1 without a Real-Debrid session', async () => {
		const res = await call({ query: { mine: '1' }, headers: {} });
		expect(statusOf(res)).toBe(401);
	});

	it('never shows a failure reason on somebody else’s row', async () => {
		mockUserId.mockResolvedValue('helper');
		mockRepo.listOpenContentRequests = vi
			.fn()
			.mockResolvedValue([row({ status: 'failed', error: 'RD credentials rejected: 401' })]);
		const res = await call();
		expect(bodyOf(res).requests[0].error).toBeNull();
	});

	it('marks each row with whether the viewer’s TorBox can send it', async () => {
		const other = 'b'.repeat(40);
		mockRepo.listOpenContentRequests = vi
			.fn()
			.mockResolvedValue([row(), row({ id: 'req-2', hash: other })]);
		vi.mocked(torboxCachedHashes).mockResolvedValue(new Set([HASH]));
		const res = await call({ headers: { 'x-rd-access-token': 'tok', 'x-tb-api-key': 'TB' } });
		expect(vi.mocked(torboxCachedHashes)).toHaveBeenCalledWith('TB', [HASH, other]);
		expect(bodyOf(res).requests.map((r: any) => r.tbCached)).toEqual([true, false]);
	});

	it('leaves the cache state unknown without a TorBox key', async () => {
		const res = await call();
		expect(vi.mocked(torboxCachedHashes)).not.toHaveBeenCalled();
		expect(bodyOf(res).requests[0].tbCached).toBeNull();
	});

	it('returns the open board', async () => {
		const res = await call();
		expect(statusOf(res)).toBe(200);
		expect(bodyOf(res).requests).toHaveLength(1);
		expect(bodyOf(res).authenticated).toBe(true);
	});

	// The board is readable without an account; the viewer just gets no `mine`.
	it('serves an anonymous viewer', async () => {
		const res = await call({ headers: {} });
		expect(statusOf(res)).toBe(200);
		expect(bodyOf(res).authenticated).toBe(false);
		expect(bodyOf(res).requests[0].mine).toBe(false);
		expect(mockRepo.listContentRequestsFor).not.toHaveBeenCalled();
	});

	// A lapsed Real-Debrid session should not blank the board.
	it('falls back to anonymous when the token is rejected', async () => {
		mockUserId.mockRejectedValue(new Error('bad token'));
		const res = await call();
		expect(statusOf(res)).toBe(200);
		expect(bodyOf(res).authenticated).toBe(false);
	});

	it('marks the caller their own rows', async () => {
		const res = await call();
		expect(bodyOf(res).requests[0].mine).toBe(true);
	});

	// The caller's own open row is on the board already; it is marked in place
	// rather than merged in from a second query, so it appears exactly once.
	it('marks the caller’s own open row in place, without a second listing', async () => {
		const res = await call();
		expect(bodyOf(res).requests).toHaveLength(1);
		expect(bodyOf(res).requests[0].mine).toBe(true);
		expect(mockRepo.listContentRequestsFor).not.toHaveBeenCalled();
	});

	it('never exposes participant ids', async () => {
		mockRepo.listOpenContentRequests = vi
			.fn()
			.mockResolvedValue([row({ fulfillerId: 'helper' })]);
		const res = await call();
		expect(JSON.stringify(bodyOf(res))).not.toContain('helper');
	});

	// The handler asks for one extra row (limit + 1) to learn whether another
	// page follows, and never returns that extra.
	it.each([
		['', 25],
		['5', 5],
		['9999', 100],
		['0', 1],
		['junk', 25],
	])('clamps limit=%s to %i and peeks one past it', async (limit, effective) => {
		await call({ query: { limit } });
		expect(mockRepo.listOpenContentRequests).toHaveBeenCalledWith(effective + 1, 0);
	});

	it('passes the offset straight through', async () => {
		await call({ query: { offset: '50' } });
		expect(mockRepo.listOpenContentRequests).toHaveBeenCalledWith(26, 50);
	});

	it.each([
		['-5', 0],
		['junk', 0],
		['', 0],
	])('clamps a bad offset=%s to %i', async (offset, expected) => {
		await call({ query: { offset } });
		expect(mockRepo.listOpenContentRequests).toHaveBeenCalledWith(26, expected);
	});

	it('reports hasMore when the peek row comes back, and hides it', async () => {
		// Twenty-six rows for a page of twenty-five: there is another page, and the
		// twenty-sixth must not be served.
		const rows = Array.from({ length: 26 }, (_, i) => row({ id: `req-${i}` }));
		mockRepo.listOpenContentRequests = vi.fn().mockResolvedValue(rows);
		const res = await call();
		expect(bodyOf(res).hasMore).toBe(true);
		expect(bodyOf(res).requests).toHaveLength(25);
	});

	it('reports no more when the page is not full', async () => {
		mockRepo.listOpenContentRequests = vi.fn().mockResolvedValue([row()]);
		const res = await call();
		expect(bodyOf(res).hasMore).toBe(false);
	});

	it('500s when the listing fails', async () => {
		mockRepo.listOpenContentRequests = vi.fn().mockRejectedValue(new Error('db down'));
		expect(statusOf(await call())).toBe(500);
	});
});

describe('POST /api/requests', () => {
	it('refuses to file a release too large for any transfer', async () => {
		const res = await post({ ...valid, sizeBytes: 150e9 });
		expect(statusOf(res)).toBe(413);
		expect(mockRepo.createContentRequest).not.toHaveBeenCalled();
	});

	it('stores the size and the page it was asked from', async () => {
		await post({ ...valid, sizeBytes: 4e9, returnPath: '/movie/tt1234567' });
		expect(mockRepo.createContentRequest).toHaveBeenCalledWith(
			expect.objectContaining({ sizeBytes: 4e9, returnPath: '/movie/tt1234567' })
		);
	});

	// 72 open requests on 2026-09-24 were for releases Real-Debrid already had.
	it('adds a release RD already has instead of filing a request for it', async () => {
		vi.mocked(alreadyOnRealDebrid).mockResolvedValue(new Map([[HASH, HASH]]));
		const res = await post(valid);
		expect(statusOf(res)).toBe(200);
		expect(bodyOf(res)).toEqual({ delivered: true });
		expect(vi.mocked(addHashToRd)).toHaveBeenCalledWith('tok', HASH);
		expect(mockRepo.createContentRequest).not.toHaveBeenCalled();
	});

	it('files the request when the add to RD does not go through', async () => {
		vi.mocked(alreadyOnRealDebrid).mockResolvedValue(new Map([[HASH, HASH]]));
		vi.mocked(addHashToRd).mockResolvedValue(false);
		await post(valid);
		expect(mockRepo.createContentRequest).toHaveBeenCalled();
	});

	const post = (
		body: unknown,
		headers: Record<string, string> = { 'x-rd-access-token': 'tok' }
	) => call({ method: 'POST', body, headers });

	const valid = { hash: HASH, imdbId: 'tt1234567', mediaType: 'movie', title: 'Some Release' };

	it('files a request for the caller', async () => {
		const res = await post(valid);
		expect(statusOf(res)).toBe(200);
		expect(mockRepo.createContentRequest).toHaveBeenCalledWith(
			expect.objectContaining({ hash: HASH, imdbId: 'tt1234567', requesterId: 'asker' })
		);
	});

	it('normalises before storing', async () => {
		await post({ ...valid, hash: HASH.toUpperCase(), mediaType: 'Movie' });
		expect(mockRepo.createContentRequest).toHaveBeenCalledWith(
			expect.objectContaining({ hash: HASH, mediaType: 'movie' })
		);
	});

	it('requires a session', async () => {
		expect(statusOf(await post(valid, {}))).toBe(401);
	});

	it('401s a rejected token rather than filing anonymously', async () => {
		mockUserId.mockRejectedValue(new Error('bad token'));
		expect(statusOf(await post(valid))).toBe(401);
		expect(mockRepo.createContentRequest).not.toHaveBeenCalled();
	});

	it.each([
		['a bad hash', { ...valid, hash: 'nope' }],
		['a bad imdb id', { ...valid, imdbId: '123' }],
		['a bad media type', { ...valid, mediaType: 'anime' }],
		['an empty body', {}],
	])('400s %s', async (_label, body) => {
		expect(statusOf(await post(body))).toBe(400);
	});

	it('500s when the write fails', async () => {
		mockRepo.createContentRequest = vi.fn().mockRejectedValue(new Error('db down'));
		expect(statusOf(await post(valid))).toBe(500);
	});
});

describe('other methods', () => {
	it('405s a DELETE', async () => {
		expect(statusOf(await call({ method: 'DELETE' }))).toBe(405);
	});
});
