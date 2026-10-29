import handler from '@/pages/api/wanted/index';
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

const mockRepository = vi.mocked(repository);
const stored = {
	id: '0b7c2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b',
	imdbId: 'tt0115082',
	kind: 'show' as const,
	title: '3rd Rock from the Sun',
	seasons: [1, 2],
	createdAt: new Date('2026-10-24T10:00:00Z'),
	fulfilledAt: null,
	lastPolledAt: new Date('2026-10-24T10:01:00Z'),
};

describe('/api/wanted', () => {
	let token: string;
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
		token = activeSponsor();
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
	});
	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.DMM_SPONSOR_SECRET;
	});

	const call = (method: string, extra: { body?: unknown; query?: Record<string, string> } = {}) =>
		createMockRequest({ method, headers: { [SPONSOR_HEADER]: token }, ...extra });

	it("lists the sponsor's titles with dates as ISO strings", async () => {
		mockRepository.listWanted = vi.fn().mockResolvedValue([stored]);
		const res = createMockResponse();
		await handler(call('GET'), res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(vi.mocked(res.json).mock.calls[0][0].items[0]).toMatchObject({
			imdbId: 'tt0115082',
			seasons: [1, 2],
			lastPolledAt: '2026-10-24T10:01:00.000Z',
			fulfilledAt: null,
		});
	});

	it('adds a show with its seasons, sorted and deduplicated', async () => {
		mockRepository.want = vi.fn().mockResolvedValue(stored);
		const res = createMockResponse();
		await handler(
			call('POST', {
				body: {
					imdbId: 'tt0115082',
					kind: 'show',
					title: ' 3rd Rock ',
					seasons: [2, 1, 2],
				},
			}),
			res
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.want).toHaveBeenCalledWith('ZP1M', {
			imdbId: 'tt0115082',
			kind: 'show',
			title: '3rd Rock',
			seasons: [1, 2],
		});
	});

	it('wants every season when none are named', async () => {
		mockRepository.want = vi.fn().mockResolvedValue(stored);
		await handler(
			call('POST', { body: { imdbId: 'tt0115082', kind: 'show', title: '3rd Rock' } }),
			createMockResponse()
		);
		expect(vi.mocked(mockRepository.want).mock.calls[0][1].seasons).toBeNull();
	});

	it.each([
		[{ imdbId: 'nope', kind: 'movie', title: 'x' }],
		[{ imdbId: 'tt0133093', kind: 'album', title: 'x' }],
		[{ imdbId: 'tt0133093', kind: 'movie', title: '' }],
		[{ imdbId: 'tt0133093', kind: 'movie', title: 'x', seasons: [1] }],
		[{ imdbId: 'tt0115082', kind: 'show', title: 'x', seasons: [0] }],
		[{ imdbId: 'tt0115082', kind: 'show', title: 'x', seasons: [] }],
	])('refuses %j', async (body) => {
		mockRepository.want = vi.fn();
		const res = createMockResponse();
		await handler(call('POST', { body }), res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockRepository.want).not.toHaveBeenCalled();
	});

	it('answers 409 when the list is full', async () => {
		mockRepository.want = vi.fn().mockResolvedValue(null);
		const res = createMockResponse();
		await handler(
			call('POST', { body: { imdbId: 'tt0133093', kind: 'movie', title: 'The Matrix' } }),
			res
		);
		expect(res.status).toHaveBeenCalledWith(409);
	});

	it('removes a title', async () => {
		mockRepository.unwant = vi.fn().mockResolvedValue(true);
		const res = createMockResponse();
		await handler(call('DELETE', { query: { imdbId: 'tt0115082' } }), res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.unwant).toHaveBeenCalledWith('ZP1M', 'tt0115082');
	});

	// One call for many, or the page's bulk remove would spend the 30-a-minute limit.
	it('removes several titles in one call', async () => {
		mockRepository.unwant = vi.fn().mockResolvedValue(2);
		const res = createMockResponse();
		await handler(call('DELETE', { body: { imdbIds: ['tt0115082', 'tt0133093'] } }), res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ ok: true, removed: 2 });
		expect(mockRepository.unwant).toHaveBeenCalledWith('ZP1M', 'tt0115082', 'tt0133093');
	});

	it('refuses a bulk remove holding anything but IMDb ids', async () => {
		mockRepository.unwant = vi.fn();
		for (const body of [{}, { imdbIds: [] }, { imdbIds: ['tt0115082', 'x'] }]) {
			const res = createMockResponse();
			await handler(call('DELETE', { body }), res);
			expect(res.status).toHaveBeenCalledWith(400);
		}
		expect(mockRepository.unwant).not.toHaveBeenCalled();
	});

	it('refuses a request without a sponsor token', async () => {
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'GET' }), res);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('refuses a sponsor whose pledge lapsed', async () => {
		sponsorshipLapsed();
		const res = createMockResponse();
		await handler(call('GET'), res);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
