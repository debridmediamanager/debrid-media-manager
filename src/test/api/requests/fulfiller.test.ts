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
	mockRepo.listContentRequestAttemptsBy = vi.fn().mockResolvedValue([]);
	mockRepo.countContentRequestsSendingBy = vi.fn().mockResolvedValue(0);
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

describe('/api/requests/fulfiller — the sends themselves', () => {
	const bodyOf = (res: any) => (res.json as any).mock.calls[0][0];

	// "3 sent" not moving after a send is what a fulfiller sees first; the
	// failed try has to be there, in plain words, saying it did not count.
	it('lists the caller’s latest tries with how each went and whether it counted', async () => {
		mockRepo.countContentRequestsSendingBy = vi.fn().mockResolvedValue(1);
		mockRepo.listContentRequestAttemptsBy = vi.fn().mockResolvedValue([
			{
				requestId: 'req-2',
				hash: 'b'.repeat(40),
				title: 'Sending Now',
				status: 'sending',
				error: null,
				createdAt: new Date('2026-11-03T23:12:39Z'),
				endedAt: null,
			},
			{
				requestId: 'req-1',
				hash: 'a'.repeat(40),
				title: "Earth's Greatest Enemy (2025)",
				status: 'failed',
				error: 'uploading stalled: no progress for 5 minutes',
				createdAt: new Date('2026-11-03T22:48:47Z'),
				endedAt: new Date('2026-11-03T23:00:11Z'),
			},
		]);
		const res = await call();
		expect(statusOf(res)).toBe(200);
		expect(mockRepo.listContentRequestAttemptsBy).toHaveBeenCalledWith(['rd-id', 'tb:abc'], 8);
		expect(bodyOf(res)).toMatchObject({
			sends: 3,
			sending: 1,
			recent: [
				{ title: 'Sending Now', status: 'sending', reason: null, endedAt: null },
				{
					title: "Earth's Greatest Enemy (2025)",
					status: 'failed',
					reason: 'Real-Debrid stopped pulling it. Not your fault, not counted.',
					startedAt: '2026-11-03T22:48:47.000Z',
					endedAt: '2026-11-03T23:00:11.000Z',
				},
			],
		});
	});
});
