import handler from '@/pages/api/stremio-pm/[userid]/play/[hash]';
import { directDownloadPremiumize } from '@/services/premiumize';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/premiumize');
vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);
const mockDirectDl = vi.mocked(directDownloadPremiumize);

const HASH = 'fbadffe5476df0674dbec75e81426895e40b6427';

describe('/api/stremio-pm/[userid]/play/[hash]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getPremiumizeCastProfile = vi
			.fn()
			.mockResolvedValue({ apiKey: 'viewer-key' });
	});

	it('returns 500 when the viewer has no profile', async () => {
		mockRepository.getPremiumizeCastProfile = vi.fn().mockResolvedValue(null);
		await handler(createMockRequest({ query: { userid: 'u', hash: HASH } }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	// The whole point of the Premiumize design: nothing is redeemed, the link is
	// minted here with the *viewer's* key. That is what makes a cast playable by
	// someone other than the caster, and it keeps the bandwidth on their account.
	it('mints the link with the viewer key rather than redeeming a stored one', async () => {
		mockDirectDl.mockResolvedValue([
			{ path: 'Show/Show.S01E01.mkv', size: 100, link: 'https://cdn/e1', stream_link: null },
		] as any);

		await handler(
			createMockRequest({
				query: { userid: 'u', hash: HASH, file: 'Show/Show.S01E01.mkv' },
			}),
			res
		);

		expect(mockDirectDl).toHaveBeenCalledWith('viewer-key', HASH);
		expect(res.redirect).toHaveBeenCalledWith('https://cdn/e1');
	});

	it('matches the requested file rather than whatever sorts first', async () => {
		mockDirectDl.mockResolvedValue([
			{ path: 'Show/Show.S01E01.mkv', size: 500, link: 'https://cdn/e1', stream_link: null },
			{ path: 'Show/Show.S01E02.mkv', size: 100, link: 'https://cdn/e2', stream_link: null },
		] as any);

		await handler(
			createMockRequest({
				query: { userid: 'u', hash: HASH, file: 'Show/Show.S01E02.mkv' },
			}),
			res
		);

		expect(res.redirect).toHaveBeenCalledWith('https://cdn/e2');
	});

	it('prefers the transcoded rendition when Premiumize made one', async () => {
		mockDirectDl.mockResolvedValue([
			{
				path: 'Movie.mkv',
				size: 100,
				link: 'https://cdn/m',
				stream_link: 'https://cdn/m-stream',
			},
		] as any);

		await handler(createMockRequest({ query: { userid: 'u', hash: HASH } }), res);

		expect(res.redirect).toHaveBeenCalledWith('https://cdn/m-stream');
	});

	it('errors rather than redirecting somewhere else when the file is gone', async () => {
		mockDirectDl.mockResolvedValue([
			{ path: 'Show/Show.S01E01.mkv', size: 100, link: 'https://cdn/e1', stream_link: null },
		] as any);

		await handler(
			createMockRequest({ query: { userid: 'u', hash: HASH, file: 'Show.S09E99.mkv' } }),
			res
		);

		expect(res.redirect).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('errors when the hash has fallen out of the Premiumize cache', async () => {
		mockDirectDl.mockRejectedValue(new Error('Unsupported link for direct download.'));

		await handler(createMockRequest({ query: { userid: 'u', hash: HASH } }), res);

		expect(res.status).toHaveBeenCalledWith(500);
	});
});
