import handler from '@/pages/api/stremio-dl/cast/library/[hash]';
import { DebridLinkError } from '@/services/debridLink';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import {
	generateDebridLinkUserId,
	resolveDebridLinkRelease,
	resolveDebridLinkTorrentById,
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
		resolveDebridLinkTorrentById: vi.fn(),
	};
});

const mockRepository = vi.mocked(repository);
const mockByHash = vi.mocked(resolveDebridLinkRelease);
const mockById = vi.mocked(resolveDebridLinkTorrentById);
const mockUserId = vi.mocked(generateDebridLinkUserId);

const HASH = 'a'.repeat(40);
const SEED = 'https://seed41.debrid.link/dl';

const release = (over: Record<string, unknown> = {}) =>
	({
		torrent: { id: 'tor-1', name: 'Show.S01', status: 100 },
		files: [
			{
				path: 'Show/Show.S01E01.mkv',
				filename: 'Show.S01E01.mkv',
				size: 1024 ** 3,
				link: `${SEED}/tor-1-0/Show.S01E01.mkv`,
				percent: 100,
			},
		],
		finished: true,
		percent: 100,
		...over,
	}) as any;

describe('/api/stremio-dl/cast/library/[hash]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockUserId.mockResolvedValue('dl-user');
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue('tt1234567');
		mockRepository.saveIMDBIdMapping = vi.fn().mockResolvedValue(undefined);
		mockRepository.saveDebridLinkCast = vi.fn().mockResolvedValue(undefined);
		mockById.mockResolvedValue(release());
		mockByHash.mockResolvedValue(release());
	});

	const req = (query: Record<string, string>, key = 'dl-token') =>
		createMockRequest({ query, headers: { authorization: `Bearer ${key}` } });

	it('casts every video and redirects to Stremio', async () => {
		await handler(req({ hash: HASH, torrentId: 'tor-1' }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.status).toBe('success');
		expect(data.imdbId).toBe('tt1234567');
		expect(mockRepository.saveDebridLinkCast).toHaveBeenCalledWith(
			expect.stringContaining('tt1234567'),
			'dl-user',
			HASH,
			'Show.S01E01.mkv',
			1024,
			'Show/Show.S01E01.mkv',
			`${SEED}/tor-1-0/Show.S01E01.mkv`
		);
	});

	// Listing a torrent by id costs no quota; resolving by hash means an add,
	// which spends one of the day's 50 torrents. Casting something the user is
	// already looking at in their own library must be free.
	it('lists by torrent id rather than spending an add', async () => {
		await handler(req({ hash: HASH, torrentId: 'tor-1' }), res);

		expect(mockById).toHaveBeenCalledWith('dl-token', 'tor-1');
		expect(mockByHash).not.toHaveBeenCalled();
	});

	it('falls back to the hash resolve when no torrent id came along', async () => {
		await handler(req({ hash: HASH }), res);

		expect(mockById).not.toHaveBeenCalled();
		expect(mockByHash).toHaveBeenCalledWith('dl-token', HASH);
	});

	it('falls back to the hash resolve when the id listing fails', async () => {
		mockById.mockRejectedValue(new DebridLinkError('locked', 'floodDetected'));

		await handler(req({ hash: HASH, torrentId: 'tor-1' }), res);

		expect(mockByHash).toHaveBeenCalledWith('dl-token', HASH);
		expect((res._getData() as any).status).toBe('success');
	});

	// The credential must come off the Authorization header, not the query
	// string - Debrid-Link accepts `?access_token=` upstream.
	it('rejects a request with no credential', async () => {
		await handler(createMockRequest({ query: { hash: HASH } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it.each(['', 'not-a-hash', 'abc'])('rejects %s as an info hash', async (hash) => {
		await handler(req({ hash }), res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockById).not.toHaveBeenCalled();
		expect(mockByHash).not.toHaveBeenCalled();
	});

	it('reports a release that is still downloading', async () => {
		mockById.mockResolvedValue(null);
		mockByHash.mockResolvedValue(release({ finished: false, percent: 21 }));

		await handler(req({ hash: HASH, torrentId: 'tor-1' }), res);

		expect(res.status).toHaveBeenCalledWith(409);
		expect(String((res._getData() as any).errorMessage)).toContain('21%');
	});

	it('asks for an IMDB id when the hash is unknown', async () => {
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue(null);
		await handler(req({ hash: HASH, torrentId: 'tor-1' }), res);

		const data = res._getData() as any;
		expect(data.status).toBe('need_imdb_id');
		expect(data.torrentInfo.hash).toBe(HASH);
		expect(mockRepository.saveDebridLinkCast).not.toHaveBeenCalled();
	});

	it('saves a user-supplied IMDB id and casts', async () => {
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue(null);
		await handler(req({ hash: HASH, torrentId: 'tor-1', imdbId: 'tt7654321' }), res);

		expect(mockRepository.saveIMDBIdMapping).toHaveBeenCalledWith(HASH, 'tt7654321');
		expect((res._getData() as any).status).toBe('success');
	});

	it('rejects a malformed IMDB id', async () => {
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue(null);
		await handler(req({ hash: HASH, torrentId: 'tor-1', imdbId: 'not-an-id' }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('spells out a Debrid-Link refusal', async () => {
		mockById.mockResolvedValue(null);
		mockByHash.mockRejectedValue(new DebridLinkError('raw', 'maxTorrent'));

		await handler(req({ hash: HASH }), res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(String((res._getData() as any).errorMessage)).toContain('50 per day');
	});
});
