import handler from '@/pages/api/stremio-oc/cast/series/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateOffcloudUserId, resolveCachedOffcloudFiles } from '@/utils/offcloudCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/offcloudCastApiHelpers');

const mockRepository = vi.mocked(repository);
const mockResolve = vi.mocked(resolveCachedOffcloudFiles);

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const episode = (name: string, size = 100) => ({
	path: `Show.S01/${name}`,
	filename: name,
	size,
	link: null,
});

const post = (body: Record<string, unknown>) =>
	createMockRequest({
		method: 'POST',
		query: { imdbid: 'tt999' },
		headers: { authorization: 'Bearer oc-key' },
		body,
	});

describe('/api/stremio-oc/cast/series/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		vi.mocked(generateOffcloudUserId).mockResolvedValue('oc-user-1');
		mockRepository.saveOffcloudCast = vi.fn().mockResolvedValue(undefined);
	});

	it('rejects a GET', async () => {
		await handler(createMockRequest({ method: 'GET', query: { imdbid: 'tt999' } }), res);
		expect(res.status).toHaveBeenCalledWith(405);
	});

	// Episodes are addressed by filename, not by index: Offcloud exposes no
	// per-file id at all, and a positional index casts the wrong episode.
	it('resolves the release once and files each episode under its own key', async () => {
		mockResolve.mockResolvedValue([
			episode('Show.S01E01.mkv'),
			episode('Show.S01E02.mkv'),
			episode('Show.S01E03.mkv'),
		]);

		await handler(post({ hash: HASH, filenames: ['Show.S01E03.mkv', 'Show.S01E01.mkv'] }), res);

		expect(mockResolve).toHaveBeenCalledTimes(1);
		expect(mockRepository.saveOffcloudCast).toHaveBeenNthCalledWith(
			1,
			'tt999:1:3',
			'oc-user-1',
			HASH,
			'Show.S01E03.mkv',
			expect.any(Number),
			'Show.S01/Show.S01E03.mkv'
		);
		expect(mockRepository.saveOffcloudCast).toHaveBeenNthCalledWith(
			2,
			'tt999:1:1',
			'oc-user-1',
			HASH,
			'Show.S01E01.mkv',
			expect.any(Number),
			'Show.S01/Show.S01E01.mkv'
		);
		expect((res._getData() as any).errorEpisodes).toEqual([]);
	});

	// The bare imdb id is the *movie* key, and the table is unique on
	// (imdbId, userId, hash) - an episode written there overwrites whatever
	// else this release already cast.
	it('refuses an episode whose filename carries no episode number', async () => {
		mockResolve.mockResolvedValue([episode('Unnamed.mkv')]);

		await handler(post({ hash: HASH, filenames: ['Unnamed.mkv'] }), res);

		expect(mockRepository.saveOffcloudCast).not.toHaveBeenCalled();
		expect((res._getData() as any).errorEpisodes).toEqual([
			'Unnamed.mkv (no episode number in filename)',
		]);
	});

	it('reports a file that is not in the release instead of casting a neighbour', async () => {
		mockResolve.mockResolvedValue([episode('Show.S01E01.mkv')]);

		await handler(post({ hash: HASH, filenames: ['Show.S09E99.mkv'] }), res);

		expect(mockRepository.saveOffcloudCast).not.toHaveBeenCalled();
		expect((res._getData() as any).status).toBe('partial');
	});

	// The browser sends only the hash, so an absent `filenames` means "every
	// episode in here" - and `cache/info` is that listing, taken server-side.
	it('casts every episode in the release when the client names none', async () => {
		mockResolve.mockResolvedValue([episode('Show.S01E01.mkv'), episode('Show.S01E02.mkv')]);

		await handler(post({ hash: HASH }), res);

		expect(mockResolve).toHaveBeenCalledTimes(1);
		expect(mockRepository.saveOffcloudCast).toHaveBeenCalledTimes(2);
		expect(res._getData() as any).toMatchObject({ status: 'success', casted: 2 });
	});

	// Extras are not failures when we picked the files ourselves - reporting
	// them would turn every successful season cast into a red toast.
	it('passes over a non-episode file without calling it an error', async () => {
		mockResolve.mockResolvedValue([
			episode('Show.S01E01.mkv'),
			episode('Show.Behind.The.Scenes.mkv'),
		]);

		await handler(post({ hash: HASH }), res);

		expect(mockRepository.saveOffcloudCast).toHaveBeenCalledTimes(1);
		expect(res._getData() as any).toMatchObject({
			status: 'success',
			casted: 1,
			errorEpisodes: [],
		});
	});

	it('reports a release Offcloud does not hold', async () => {
		mockResolve.mockResolvedValue([]);

		await handler(post({ hash: HASH }), res);

		expect(mockRepository.saveOffcloudCast).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('validates the request body', async () => {
		await handler(post({}), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});
});
