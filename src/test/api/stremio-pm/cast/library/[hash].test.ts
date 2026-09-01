import handler from '@/pages/api/stremio-pm/cast/library/[hash]';
import { directDownloadPremiumize } from '@/services/premiumize';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generatePremiumizeUserId } from '@/utils/premiumizeCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/premiumize', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/premiumize')>('@/services/premiumize');
	return { ...actual, directDownloadPremiumize: vi.fn() };
});
vi.mock('@/utils/premiumizeCastApiHelpers', () => ({ generatePremiumizeUserId: vi.fn() }));

const mockRepository = vi.mocked(repository);
const mockDirectDl = vi.mocked(directDownloadPremiumize);
const mockUserId = vi.mocked(generatePremiumizeUserId);

const HASH = 'a'.repeat(40);
const cdn = (name: string) => `https://x.energycdn.com/${name}`;

describe('/api/stremio-pm/cast/library/[hash]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockUserId.mockResolvedValue('pm-user');
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue('tt1234567');
		mockRepository.saveIMDBIdMapping = vi.fn().mockResolvedValue(undefined);
		mockRepository.savePremiumizeCast = vi.fn().mockResolvedValue(undefined);
		mockDirectDl.mockResolvedValue([
			{ path: 'Show/Show.S01E01.mkv', size: 1024 ** 3, link: cdn('e1'), stream_link: null },
			{ path: 'Show/poster.jpg', size: 10, link: cdn('p'), stream_link: null },
		] as any);
	});

	const req = (query: Record<string, string>, key = 'pm-key') =>
		createMockRequest({ query, headers: { authorization: `Bearer ${key}` } });

	it('casts every video and redirects to Stremio', async () => {
		await handler(req({ hash: HASH }), res);
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.status).toBe('success');
		expect(data.imdbId).toBe('tt1234567');
		// Only the video is cast; the poster is not a stream.
		expect(mockRepository.savePremiumizeCast).toHaveBeenCalledTimes(1);
		expect(mockRepository.savePremiumizeCast).toHaveBeenCalledWith(
			expect.stringContaining('tt1234567'),
			'pm-user',
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

	// A Premiumize row whose transfer record was cleared reports no info hash;
	// there is nothing to resolve, so it must not reach directdl.
	it.each(['', 'not-a-hash', 'abc'])('rejects %s as an info hash', async (hash) => {
		await handler(req({ hash }), res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockDirectDl).not.toHaveBeenCalled();
	});

	it('asks for an IMDB id when the hash is unknown', async () => {
		mockRepository.getIMDBIdByHash = vi.fn().mockResolvedValue(null);
		await handler(req({ hash: HASH }), res);
		const data = res._getData() as any;
		expect(data.status).toBe('need_imdb_id');
		expect(data.torrentInfo.hash).toBe(HASH);
		expect(mockRepository.savePremiumizeCast).not.toHaveBeenCalled();
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

	it('400s a release with no video in it', async () => {
		mockDirectDl.mockResolvedValue([
			{ path: 'poster.jpg', size: 10, link: cdn('p'), stream_link: null },
		] as any);
		await handler(req({ hash: HASH }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('500s when Premiumize will not resolve the hash', async () => {
		mockDirectDl.mockRejectedValue(new Error('service_unsupported'));
		await handler(req({ hash: HASH }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
