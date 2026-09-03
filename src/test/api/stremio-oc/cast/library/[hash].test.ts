import handler from '@/pages/api/stremio-oc/cast/library/[hash]';
import { exploreOffcloudCloud } from '@/services/offcloud';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateOffcloudUserId, resolveCachedOffcloudFiles } from '@/utils/offcloudCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/offcloud', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/offcloud')>('@/services/offcloud');
	return { ...actual, exploreOffcloudCloud: vi.fn() };
});
vi.mock('@/utils/offcloudCastApiHelpers', () => ({
	generateOffcloudUserId: vi.fn(),
	resolveCachedOffcloudFiles: vi.fn(),
}));

const mockRepository = vi.mocked(repository);
const mockResolve = vi.mocked(resolveCachedOffcloudFiles);
const mockExplore = vi.mocked(exploreOffcloudCloud);
const mockUserId = vi.mocked(generateOffcloudUserId);

const HASH = 'a'.repeat(40);
const CDN = 'https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/n-sto/obj/100000001/1788380601/tok/sig';

describe('/api/stremio-oc/cast/library/[hash]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockUserId.mockResolvedValue('oc-user');
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue('tt1234567');
		mockRepository.saveIMDBIdMapping = vi.fn().mockResolvedValue(undefined);
		mockRepository.saveOffcloudCast = vi.fn().mockResolvedValue(undefined);
		mockResolve.mockResolvedValue([
			{
				path: 'Show/Show.S01E01.mkv',
				filename: 'Show.S01E01.mkv',
				size: 1024 ** 3,
				link: null,
			},
		]);
		mockExplore.mockResolvedValue([]);
	});

	const req = (query: Record<string, string>, key = 'oc-key') =>
		createMockRequest({ query, headers: { authorization: `Bearer ${key}` } });

	it('casts every video and redirects to Stremio', async () => {
		await handler(req({ hash: HASH }), res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.status).toBe('success');
		expect(data.imdbId).toBe('tt1234567');
		expect(mockRepository.saveOffcloudCast).toHaveBeenCalledWith(
			expect.stringContaining('tt1234567'),
			'oc-user',
			HASH,
			'Show.S01E01.mkv',
			1024,
			'Show/Show.S01E01.mkv'
		);
	});

	// The key must come off the Authorization header, not the query string.
	it('rejects a request with no key', async () => {
		await handler(createMockRequest({ query: { hash: HASH } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	// A row created from a plain HTTP submission reports no info hash; there is
	// nothing to resolve, so it must not reach the cache probe.
	it.each(['', 'not-a-hash', 'abc'])('rejects %s as an info hash', async (hash) => {
		await handler(req({ hash }), res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	// An item Offcloud downloaded for this account but does not hold in the
	// shared cache reads back as uncached, and `cloud/explore` on the caller's
	// own item is the only thing that can still list it.
	it('falls back to explore when the cache does not hold the item', async () => {
		mockResolve.mockResolvedValue([]);
		mockExplore.mockResolvedValue([`${CDN}/Movie.mkv`, `${CDN}/poster.jpg`]);

		await handler(req({ hash: HASH, requestId: 'req1' }), res);

		expect(mockExplore).toHaveBeenCalledWith('oc-key', 'req1');
		expect((res._getData() as any).status).toBe('success');
		// Only the video is cast; the poster is not a stream.
		expect(mockRepository.saveOffcloudCast).toHaveBeenCalledTimes(1);
	});

	it('400s an uncached release when no request id came along', async () => {
		mockResolve.mockResolvedValue([]);
		await handler(req({ hash: HASH }), res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockExplore).not.toHaveBeenCalled();
	});

	it('asks for an IMDB id when the hash is unknown', async () => {
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue(null);
		await handler(req({ hash: HASH }), res);
		const data = res._getData() as any;
		expect(data.status).toBe('need_imdb_id');
		expect(data.torrentInfo.hash).toBe(HASH);
		expect(mockRepository.saveOffcloudCast).not.toHaveBeenCalled();
	});

	it('saves a user-supplied IMDB id and casts', async () => {
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue(null);
		await handler(req({ hash: HASH, imdbId: 'tt7654321' }), res);
		expect(mockRepository.saveIMDBIdMapping).toHaveBeenCalledWith(HASH, 'tt7654321');
		expect((res._getData() as any).status).toBe('success');
	});

	it('rejects a malformed IMDB id', async () => {
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue(null);
		await handler(req({ hash: HASH, imdbId: 'not-an-id' }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('500s when the cache probe itself fails', async () => {
		mockResolve.mockRejectedValue(new Error('NOAUTH'));
		await handler(req({ hash: HASH }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
