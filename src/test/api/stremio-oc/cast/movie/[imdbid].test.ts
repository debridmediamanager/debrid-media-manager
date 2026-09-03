import handler from '@/pages/api/stremio-oc/cast/movie/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateOffcloudUserId, resolveCachedOffcloudFiles } from '@/utils/offcloudCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/offcloudCastApiHelpers');

const mockRepository = vi.mocked(repository);
const mockResolve = vi.mocked(resolveCachedOffcloudFiles);

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

const file = (path: string, size: number) => ({
	path,
	filename: path.split('/').pop()!,
	size,
	link: null,
});

describe('/api/stremio-oc/cast/movie/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		vi.mocked(generateOffcloudUserId).mockResolvedValue('oc-user-1');
		mockRepository.saveOffcloudCast = vi.fn().mockResolvedValue(undefined);
	});

	it('rejects a request with no key', async () => {
		await handler(createMockRequest({ query: { imdbid: 'tt123', hash: HASH } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	// The Offcloud key is the whole account and also authenticates as `?key=`
	// upstream, so it must never reach a URL.
	it('takes the key from the Authorization header rather than the query string', async () => {
		mockResolve.mockResolvedValue([file('Movie/Movie.mkv', 90_000_000)]);

		await handler(
			createMockRequest({
				query: { imdbid: 'tt123', hash: HASH },
				headers: { authorization: 'Bearer oc-key' },
			}),
			res
		);

		expect(mockResolve).toHaveBeenCalledWith('oc-key', HASH);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('stores the feature, not whatever Offcloud listed first', async () => {
		mockResolve.mockResolvedValue([
			file('Movie/Movie.2019.mkv', 276_134_947),
			file('Movie/Movie.Featurette.mkv', 310_380),
		]);

		await handler(
			createMockRequest({
				query: { imdbid: 'tt123', hash: HASH },
				headers: { authorization: 'Bearer oc-key' },
			}),
			res
		);

		expect(mockRepository.saveOffcloudCast).toHaveBeenCalledWith(
			'tt123',
			'oc-user-1',
			HASH,
			'Movie.2019.mkv',
			263,
			'Movie/Movie.2019.mkv'
		);
	});

	// The row holds a hash and a path. An Offcloud CDN URL carries the caster's
	// account-scoped token, so storing one would hand it to every viewer.
	it('stores no link', async () => {
		mockResolve.mockResolvedValue([file('Movie.mkv', 100)]);

		await handler(
			createMockRequest({
				query: { imdbid: 'tt123', hash: HASH },
				headers: { authorization: 'Bearer oc-key' },
			}),
			res
		);

		const args = mockRepository.saveOffcloudCast.mock.calls[0];
		expect(args.some((arg) => typeof arg === 'string' && arg.startsWith('http'))).toBe(false);
	});

	// A miss reads back as an empty listing, and that is the right refusal: play
	// resolves by hash with the viewer's key, so an uncached cast is unplayable.
	it('reports a release Offcloud does not hold rather than casting it', async () => {
		mockResolve.mockResolvedValue([]);

		await handler(
			createMockRequest({
				query: { imdbid: 'tt123', hash: HASH },
				headers: { authorization: 'Bearer oc-key' },
			}),
			res
		);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(mockRepository.saveOffcloudCast).not.toHaveBeenCalled();
	});

	it('surfaces a failed probe as an error', async () => {
		mockResolve.mockRejectedValue(new Error('NOAUTH'));

		await handler(
			createMockRequest({
				query: { imdbid: 'tt123', hash: HASH },
				headers: { authorization: 'Bearer oc-key' },
			}),
			res
		);

		expect(res.status).toHaveBeenCalledWith(500);
	});
});
