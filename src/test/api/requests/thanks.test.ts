import handler from '@/pages/api/requests/[id]/thanks';
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
		method: 'POST',
		query: { id: 'req-1' },
		headers: { 'x-rd-access-token': 'asker-token' },
		...over,
	});
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

const statusOf = (res: any) => (res.status as any).mock.calls[0][0];

beforeEach(() => {
	vi.clearAllMocks();
	mockUserId.mockResolvedValue('asker');
	mockRepo.thankContentRequest = vi.fn().mockResolvedValue('helper');
});

describe('POST /api/requests/[id]/thanks', () => {
	it('thanks the sender of the caller’s own request', async () => {
		expect(statusOf(await call())).toBe(200);
		expect(mockRepo.thankContentRequest).toHaveBeenCalledWith('req-1', 'asker');
	});

	it('answers 409 for a row that cannot be thanked', async () => {
		mockRepo.thankContentRequest = vi.fn().mockResolvedValue(null);
		expect(statusOf(await call())).toBe(409);
	});

	it('requires a Real-Debrid session', async () => {
		expect(statusOf(await call({ headers: {} }))).toBe(401);
		expect(mockRepo.thankContentRequest).not.toHaveBeenCalled();
	});

	it('refuses anything but POST', async () => {
		expect(statusOf(await call({ method: 'GET' }))).toBe(405);
	});
});
