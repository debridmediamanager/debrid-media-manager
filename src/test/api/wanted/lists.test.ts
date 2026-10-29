import handler from '@/pages/api/wanted/lists';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { ListUnreadable, syncWantedList } from '@/services/wantedLists';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { activeSponsor } from '@/test/utils/sponsor';
import { SPONSOR_HEADER } from '@/utils/requireSponsor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));
// Reads Trakt and MDBList; `wantedLists.test.ts` drives the real one from recorded pages.
vi.mock('@/services/wantedLists', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/wantedLists')>()),
	syncWantedList: vi.fn(),
}));

const mockRepository = vi.mocked(repository);

const stored = {
	id: 'list-1',
	shortId: 'ZP1M',
	url: 'https://trakt.tv/users/giladg/lists/latest-4k-releases',
	name: "giladg's latest-4k-releases",
	seen: [] as string[],
	added: 0,
	createdAt: new Date('2026-10-29T10:00:00Z'),
	syncedAt: null,
	error: null,
};

describe('/api/wanted/lists', () => {
	let token: string;
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
		token = activeSponsor();
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
		mockRepository.followWantedList = vi.fn().mockResolvedValue({ row: stored, created: true });
		mockRepository.unfollowWantedList = vi.fn().mockResolvedValue(true);
		mockRepository.listWantedLists = vi.fn().mockResolvedValue([
			{
				...stored,
				name: 'Latest 4K Releases',
				seen: ['tt38504402'],
				added: 1,
				syncedAt: new Date('2026-10-29T10:00:05Z'),
			},
		]);
	});
	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.DMM_SPONSOR_SECRET;
	});

	const call = (method: string, extra: { body?: unknown; query?: Record<string, string> } = {}) =>
		createMockRequest({ method, headers: { [SPONSOR_HEADER]: token }, ...extra });

	it('follows a pasted list page, reads it at once and answers with what that did', async () => {
		vi.mocked(syncWantedList).mockResolvedValue({
			name: 'Latest 4K Releases',
			count: 1,
			added: 1,
			alreadyWanted: 0,
			overCap: 0,
			noImdbId: 0,
		});
		const res = createMockResponse();
		await handler(
			call('POST', {
				body: { url: 'https://app.trakt.tv/users/giladg/lists/latest-4k-releases/' },
			}),
			res
		);
		expect(mockRepository.followWantedList).toHaveBeenCalledWith(
			'ZP1M',
			'https://trakt.tv/users/giladg/lists/latest-4k-releases',
			"giladg's latest-4k-releases"
		);
		expect(syncWantedList).toHaveBeenCalledWith(stored);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			name: 'Latest 4K Releases',
			count: 1,
			added: 1,
			alreadyWanted: 0,
			overCap: 0,
			noImdbId: 0,
			list: {
				id: 'list-1',
				url: 'https://trakt.tv/users/giladg/lists/latest-4k-releases',
				name: 'Latest 4K Releases',
				count: 1,
				added: 1,
				createdAt: '2026-10-29T10:00:00.000Z',
				syncedAt: '2026-10-29T10:00:05.000Z',
				error: null,
			},
		});
	});

	it('refuses a page that is not a list, naming the ones it takes', async () => {
		const res = createMockResponse();
		await handler(
			call('POST', { body: { url: 'https://www.imdb.com/list/ls055592025/' } }),
			res
		);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: expect.stringContaining('mdblist.com/lists/'),
		});
		expect(mockRepository.followWantedList).not.toHaveBeenCalled();
	});

	it('does not keep following a list it could not read', async () => {
		vi.mocked(syncWantedList).mockRejectedValue(
			new ListUnreadable('Trakt has no such list or user')
		);
		const res = createMockResponse();
		await handler(
			call('POST', { body: { url: 'https://trakt.tv/users/nobody/lists/nothing' } }),
			res
		);
		expect(mockRepository.unfollowWantedList).toHaveBeenCalledWith('ZP1M', 'list-1');
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Trakt has no such list or user' });
	});

	it('keeps a list already followed when reading it again fails', async () => {
		mockRepository.followWantedList = vi
			.fn()
			.mockResolvedValue({ row: stored, created: false });
		vi.mocked(syncWantedList).mockRejectedValue(
			new ListUnreadable('Trakt could not be read (503)')
		);
		const res = createMockResponse();
		await handler(call('POST', { body: { url: stored.url } }), res);
		expect(mockRepository.unfollowWantedList).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(502);
	});

	it('unfollows by id', async () => {
		const res = createMockResponse();
		await handler(call('DELETE', { query: { id: 'list-1' } }), res);
		expect(mockRepository.unfollowWantedList).toHaveBeenCalledWith('ZP1M', 'list-1');
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('is for sponsors', async () => {
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'GET' }), res);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
