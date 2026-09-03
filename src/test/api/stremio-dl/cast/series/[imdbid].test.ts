import handler from '@/pages/api/stremio-dl/cast/series/[imdbid]';
import { DebridLinkError } from '@/services/debridLink';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import {
	generateDebridLinkUserId,
	resolveDebridLinkRelease,
} from '@/utils/debridLinkCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/debridLinkCastApiHelpers', async () => {
	const actual = await vi.importActual<typeof import('@/utils/debridLinkCastApiHelpers')>(
		'@/utils/debridLinkCastApiHelpers'
	);
	return {
		...actual,
		generateDebridLinkUserId: vi.fn(),
		resolveDebridLinkRelease: vi.fn(),
	};
});

const mockRepository = vi.mocked(repository);
const mockResolve = vi.mocked(resolveDebridLinkRelease);

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const SEED = 'https://seed41.debrid.link/dl';

const episode = (name: string, size = 100) => ({
	path: `Show.S01/${name}`,
	filename: name,
	size,
	link: `${SEED}/tor-1-0/${name}`,
	percent: 100,
});

const release = (files: ReturnType<typeof episode>[], over: Record<string, unknown> = {}) =>
	({
		torrent: { id: 'tor-1', name: 'Show.S01', status: 100 },
		files,
		finished: true,
		percent: 100,
		...over,
	}) as any;

const post = (body: Record<string, unknown>) =>
	createMockRequest({
		method: 'POST',
		query: { imdbid: 'tt999' },
		headers: { authorization: 'Bearer dl-token' },
		body,
	});

describe('/api/stremio-dl/cast/series/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		vi.mocked(generateDebridLinkUserId).mockResolvedValue('dl-user-1');
		mockRepository.saveDebridLinkCast = vi.fn().mockResolvedValue(undefined);
	});

	it('rejects a GET', async () => {
		await handler(createMockRequest({ method: 'GET', query: { imdbid: 'tt999' } }), res);
		expect(res.status).toHaveBeenCalledWith(405);
	});

	// Episodes are addressed by filename, not by index: a positional index casts
	// the wrong episode, and Debrid-Link's own file ids are not a stable key.
	it('resolves the release once and files each episode under its own key', async () => {
		mockResolve.mockResolvedValue(
			release([
				episode('Show.S01E01.mkv'),
				episode('Show.S01E02.mkv'),
				episode('Show.S01E03.mkv'),
			])
		);

		await handler(post({ hash: HASH, filenames: ['Show.S01E03.mkv', 'Show.S01E01.mkv'] }), res);

		expect(mockResolve).toHaveBeenCalledTimes(1);
		expect(mockRepository.saveDebridLinkCast).toHaveBeenNthCalledWith(
			1,
			'tt999:1:3',
			'dl-user-1',
			HASH,
			'Show.S01E03.mkv',
			expect.any(Number),
			'Show.S01/Show.S01E03.mkv',
			`${SEED}/tor-1-0/Show.S01E03.mkv`
		);
		expect(mockRepository.saveDebridLinkCast).toHaveBeenNthCalledWith(
			2,
			'tt999:1:1',
			'dl-user-1',
			HASH,
			'Show.S01E01.mkv',
			expect.any(Number),
			'Show.S01/Show.S01E01.mkv',
			`${SEED}/tor-1-0/Show.S01E01.mkv`
		);
		expect((res._getData() as any).errorEpisodes).toEqual([]);
	});

	// One add, whatever the episode count - and that one add is the only quota
	// this route can spend.
	it('spends exactly one add for a whole season', async () => {
		mockResolve.mockResolvedValue(
			release(
				Array.from({ length: 10 }, (_, i) =>
					episode(`Show.S01E${String(i + 1).padStart(2, '0')}.mkv`)
				)
			)
		);

		await handler(post({ hash: HASH }), res);

		expect(mockResolve).toHaveBeenCalledTimes(1);
		expect(mockRepository.saveDebridLinkCast).toHaveBeenCalledTimes(10);
	});

	// The bare imdb id is the *movie* key, and the table is unique on
	// (imdbId, userId, hash) - an episode written there overwrites whatever else
	// this release already cast.
	it('refuses an episode whose filename carries no episode number', async () => {
		mockResolve.mockResolvedValue(release([episode('Unnamed.mkv')]));

		await handler(post({ hash: HASH, filenames: ['Unnamed.mkv'] }), res);

		expect(mockRepository.saveDebridLinkCast).not.toHaveBeenCalled();
		expect((res._getData() as any).errorEpisodes).toEqual([
			'Unnamed.mkv (no episode number in filename)',
		]);
	});

	it('reports a file that is not in the release instead of casting a neighbour', async () => {
		mockResolve.mockResolvedValue(release([episode('Show.S01E01.mkv')]));

		await handler(post({ hash: HASH, filenames: ['Show.S09E99.mkv'] }), res);

		expect(mockRepository.saveDebridLinkCast).not.toHaveBeenCalled();
		expect((res._getData() as any).status).toBe('partial');
	});

	// The browser sends only the hash, so an absent `filenames` means "every
	// episode in here" - and the add answers with that listing.
	it('casts every episode in the release when the client names none', async () => {
		mockResolve.mockResolvedValue(
			release([episode('Show.S01E01.mkv'), episode('Show.S01E02.mkv')])
		);

		await handler(post({ hash: HASH }), res);

		expect(mockRepository.saveDebridLinkCast).toHaveBeenCalledTimes(2);
		expect(res._getData() as any).toMatchObject({ status: 'success', casted: 2 });
	});

	// Extras are not failures when we picked the files ourselves - reporting them
	// would turn every successful season cast into a red toast.
	it('passes over a non-episode file without calling it an error', async () => {
		mockResolve.mockResolvedValue(
			release([episode('Show.S01E01.mkv'), episode('Show.Behind.The.Scenes.mkv')])
		);

		await handler(post({ hash: HASH }), res);

		expect(mockRepository.saveDebridLinkCast).toHaveBeenCalledTimes(1);
		expect(res._getData() as any).toMatchObject({
			status: 'success',
			casted: 1,
			errorEpisodes: [],
		});
	});

	it('reports a release still downloading rather than casting half of it', async () => {
		mockResolve.mockResolvedValue(
			release([episode('Show.S01E01.mkv')], { finished: false, percent: 8 })
		);

		await handler(post({ hash: HASH }), res);

		expect(res.status).toHaveBeenCalledWith(409);
		expect(String((res._getData() as any).errorMessage)).toContain('8%');
		expect(mockRepository.saveDebridLinkCast).not.toHaveBeenCalled();
	});

	it('reports a release with no episodes in it', async () => {
		mockResolve.mockResolvedValue(release([]));

		await handler(post({ hash: HASH }), res);

		expect(mockRepository.saveDebridLinkCast).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('spells out a quota refusal', async () => {
		mockResolve.mockRejectedValue(new DebridLinkError('raw', 'maxTransfer'));

		await handler(post({ hash: HASH }), res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(String((res._getData() as any).errorMessage)).toContain('20 active transfers');
	});

	it('validates the request body', async () => {
		await handler(post({}), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});
});
