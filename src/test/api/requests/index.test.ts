import handler from '@/pages/api/requests';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateUserId } from '@/utils/castApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
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
	mockUserId.mockResolvedValue('asker');
	mockRepo.listOpenContentRequests = vi.fn().mockResolvedValue([row()]);
	mockRepo.listContentRequestsFor = vi.fn().mockResolvedValue([]);
	mockRepo.createContentRequest = vi.fn().mockResolvedValue(row());
});

describe('GET /api/requests', () => {
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
