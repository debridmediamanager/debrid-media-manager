import handler from '@/pages/api/stremio-pm/cast/movie/[imdbid]';
import { directDownloadPremiumize } from '@/services/premiumize';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generatePremiumizeUserId } from '@/utils/premiumizeCastApiHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/premiumize');
vi.mock('@/services/repository');
vi.mock('@/utils/premiumizeCastApiHelpers');

const mockRepository = vi.mocked(repository);
const mockDirectDl = vi.mocked(directDownloadPremiumize);

const HASH = 'fbadffe5476df0674dbec75e81426895e40b6427';

describe('/api/stremio-pm/cast/movie/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		vi.mocked(generatePremiumizeUserId).mockResolvedValue('pm-user-1');
		mockRepository.savePremiumizeCast = vi.fn().mockResolvedValue(undefined);
	});

	it('rejects a request with no key', async () => {
		const req = createMockRequest({ query: { imdbid: 'tt123', hash: HASH } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('takes the key from the Authorization header rather than the query string', async () => {
		mockDirectDl.mockResolvedValue([
			{ path: 'Movie/Movie.mkv', size: 90_000_000, link: 'https://cdn/m', stream_link: null },
		] as any);

		const req = createMockRequest({
			query: { imdbid: 'tt123', hash: HASH },
			headers: { authorization: 'Bearer pm-key' },
		});
		await handler(req, res);

		expect(mockDirectDl).toHaveBeenCalledWith('pm-key', HASH);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	// directdl's top-level location/filename/filesize mirror content[0], which
	// for a torrent is whatever sorts first - a poster JPEG in the reference
	// case. A client written against those fields casts an image.
	it('stores the feature, not whatever Premiumize listed first', async () => {
		mockDirectDl.mockResolvedValue([
			{ path: 'Movie/poster.jpg', size: 310_380, link: 'https://cdn/p', stream_link: null },
			{ path: 'Movie/subs.srt', size: 140, link: 'https://cdn/s', stream_link: null },
			{
				path: 'Movie/Movie.2019.mkv',
				size: 276_134_947,
				link: 'https://cdn/m',
				stream_link: 'https://cdn/m-stream',
			},
		] as any);

		const req = createMockRequest({
			query: { imdbid: 'tt123', hash: HASH },
			headers: { authorization: 'Bearer pm-key' },
		});
		await handler(req, res);

		expect(mockRepository.savePremiumizeCast).toHaveBeenCalledWith(
			'tt123',
			'pm-user-1',
			HASH,
			'Movie.2019.mkv',
			263,
			'Movie/Movie.2019.mkv'
		);
	});

	// The row holds a hash and a path. A link would rot, and Premiumize bills
	// the minting account, so a caster's link would spend the caster's quota.
	it('stores no link', async () => {
		mockDirectDl.mockResolvedValue([
			{ path: 'Movie.mkv', size: 100, link: 'https://cdn/m', stream_link: null },
		] as any);

		const req = createMockRequest({
			query: { imdbid: 'tt123', hash: HASH },
			headers: { authorization: 'Bearer pm-key' },
		});
		await handler(req, res);

		const args = mockRepository.savePremiumizeCast.mock.calls[0];
		expect(args.some((arg) => typeof arg === 'string' && arg.startsWith('http'))).toBe(false);
	});

	it('reports a release with no video rather than casting a subtitle', async () => {
		mockDirectDl.mockResolvedValue([
			{ path: 'Movie/subs.srt', size: 140, link: 'https://cdn/s', stream_link: null },
		] as any);

		const req = createMockRequest({
			query: { imdbid: 'tt123', hash: HASH },
			headers: { authorization: 'Bearer pm-key' },
		});
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(mockRepository.savePremiumizeCast).not.toHaveBeenCalled();
	});

	it('surfaces a cache miss as an error', async () => {
		mockDirectDl.mockRejectedValue(new Error('Unsupported link for direct download.'));

		const req = createMockRequest({
			query: { imdbid: 'tt123', hash: HASH },
			headers: { authorization: 'Bearer pm-key' },
		});
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
	});
});
