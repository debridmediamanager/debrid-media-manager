import handler from '@/pages/api/requests/fulfiller';
import { creditFulfiller, fulfillerStats } from '@/services/fulfillerRewards';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateUserId } from '@/utils/castApiHelpers';
import { torboxUserId } from '@/utils/torboxIdentity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/fulfillerRewards', () => ({
	creditFulfiller: vi.fn(),
	fulfillerStats: vi.fn(),
}));
vi.mock('@/utils/castApiHelpers', () => ({ __esModule: true, generateUserId: vi.fn() }));
vi.mock('@/utils/torboxIdentity', () => ({ torboxUserId: vi.fn() }));

const mockRepo = vi.mocked(repository);
const KEY = 'a'.repeat(64);

const call = async (over: Record<string, unknown> = {}) => {
	const req = createMockRequest({
		method: 'GET',
		headers: { 'x-tb-api-key': 'tb-key', 'x-rd-access-token': 'rd-token' },
		...over,
	});
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

const statusOf = (res: any) => (res.status as any).mock.calls[0][0];

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(generateUserId).mockResolvedValue('rd-id');
	vi.mocked(torboxUserId).mockResolvedValue('tb:abc');
	vi.mocked(fulfillerStats).mockResolvedValue({ sends: 3 } as any);
	mockRepo.getSponsorByDmmApiKey = vi
		.fn()
		.mockResolvedValue({ shortId: 'ZP1M', isSponsor: false });
	mockRepo.linkFulfillers = vi.fn().mockResolvedValue(undefined);
});

describe('/api/requests/fulfiller', () => {
	// The fulfil route records whichever id the caller had, so both are read.
	it('reads sends under both the Real-Debrid and the TorBox id', async () => {
		expect(statusOf(await call())).toBe(200);
		expect(fulfillerStats).toHaveBeenCalledWith(['rd-id', 'tb:abc']);
	});

	it('requires a key it can verify', async () => {
		vi.mocked(torboxUserId).mockResolvedValue(null);
		expect(statusOf(await call({ headers: { 'x-tb-api-key': 'bad' } }))).toBe(401);
	});

	// Earning sponsor time is open to people who have never paid.
	it('links a key whose account is not a sponsor, then credits past sends', async () => {
		const res = await call({ method: 'POST', body: { apiKey: KEY, showName: true } });
		expect(statusOf(res)).toBe(200);
		expect(mockRepo.linkFulfillers).toHaveBeenCalledWith(['rd-id', 'tb:abc'], 'ZP1M', true);
		expect(creditFulfiller).toHaveBeenCalledWith('rd-id');
	});

	it('keeps the name hidden unless asked', async () => {
		await call({ method: 'POST', body: { apiKey: KEY } });
		expect(mockRepo.linkFulfillers).toHaveBeenCalledWith(['rd-id', 'tb:abc'], 'ZP1M', false);
	});

	it('refuses an unknown key', async () => {
		mockRepo.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(null);
		const res = await call({ method: 'POST', body: { apiKey: KEY } });
		expect(statusOf(res)).toBe(404);
		expect(mockRepo.linkFulfillers).not.toHaveBeenCalled();
	});
});
