import handler from '@/pages/api/requests/[id]/index';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateUserId } from '@/utils/castApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/castApiHelpers', () => ({ __esModule: true, generateUserId: vi.fn() }));

const mockRepo = vi.mocked(repository);
const mockUserId = vi.mocked(generateUserId);

const call = async (over: Record<string, unknown> = {}) => {
	const req = createMockRequest({
		method: 'DELETE',
		query: { id: 'req-1' },
		headers: { 'x-rd-access-token': 'asker-token' },
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
	mockRepo.cancelContentRequest = vi.fn().mockResolvedValue(true);
});

describe('DELETE /api/requests/[id]', () => {
	it('cancels the caller’s own request', async () => {
		const res = await call();
		expect(statusOf(res)).toBe(200);
		expect(bodyOf(res)).toEqual({ cancelled: true });
		expect(mockRepo.cancelContentRequest).toHaveBeenCalledWith('req-1', 'asker');
	});

	it('scopes the delete to the caller, never to the id alone', async () => {
		mockUserId.mockResolvedValue('somebody-else');
		await call();
		// The requester id reaches the query, so a stranger's delete matches no row
		// rather than being refused by a check the database never sees.
		expect(mockRepo.cancelContentRequest).toHaveBeenCalledWith('req-1', 'somebody-else');
	});

	it('answers 409 when nothing was cancelled', async () => {
		mockRepo.cancelContentRequest = vi.fn().mockResolvedValue(false);
		const res = await call();
		expect(statusOf(res)).toBe(409);
	});

	it('gives the same answer for another’s row as for a missing one', async () => {
		mockRepo.cancelContentRequest = vi.fn().mockResolvedValue(false);
		const theirs = bodyOf(await call({ query: { id: 'someone-elses' } }));
		const missing = bodyOf(await call({ query: { id: 'no-such-row' } }));
		// Distinguishing them would let anyone holding an id probe the board for
		// whose row it is.
		expect(theirs).toEqual(missing);
	});

	it('requires a Real-Debrid session', async () => {
		const res = await call({ headers: {} });
		expect(statusOf(res)).toBe(401);
		expect(mockRepo.cancelContentRequest).not.toHaveBeenCalled();
	});

	it('refuses a token it cannot turn into an id', async () => {
		mockUserId.mockRejectedValue(new Error('bad token'));
		const res = await call();
		expect(statusOf(res)).toBe(401);
		expect(mockRepo.cancelContentRequest).not.toHaveBeenCalled();
	});

	it('requires an id', async () => {
		const res = await call({ query: {} });
		expect(statusOf(res)).toBe(400);
	});

	it('refuses anything but DELETE', async () => {
		const res = await call({ method: 'POST' });
		expect(statusOf(res)).toBe(405);
		expect(mockRepo.cancelContentRequest).not.toHaveBeenCalled();
	});

	it('answers 500 when the database fails', async () => {
		mockRepo.cancelContentRequest = vi.fn().mockRejectedValue(new Error('down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = await call();
		expect(statusOf(res)).toBe(500);
	});
});
