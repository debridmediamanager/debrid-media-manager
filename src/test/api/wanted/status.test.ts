import handler from '@/pages/api/wanted/status';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { activeSponsor, sponsorshipLapsed } from '@/test/utils/sponsor';
import { SPONSOR_HEADER } from '@/utils/requireSponsor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

describe('/api/wanted/status', () => {
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
	});
	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.DMM_SPONSOR_SECRET;
	});

	it("answers the sponsor's list in one row, dates as ISO strings", async () => {
		vi.mocked(repository).wantedSummary = vi.fn().mockResolvedValue({
			count: 1800,
			since: new Date('2026-10-27T00:46:34Z'),
			lastPolledAt: null,
		});
		const res = createMockResponse();
		await handler(
			createMockRequest({ method: 'GET', headers: { [SPONSOR_HEADER]: activeSponsor() } }),
			res
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(vi.mocked(res.json).mock.calls[0][0]).toEqual({
			count: 1800,
			since: '2026-10-27T00:46:34.000Z',
			lastPolledAt: null,
		});
	});

	it('is for sponsors only', async () => {
		const res = createMockResponse();
		const token = activeSponsor();
		sponsorshipLapsed();
		await handler(
			createMockRequest({ method: 'GET', headers: { [SPONSOR_HEADER]: token } }),
			res
		);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(repository.wantedSummary).not.toHaveBeenCalled();
	});
});
