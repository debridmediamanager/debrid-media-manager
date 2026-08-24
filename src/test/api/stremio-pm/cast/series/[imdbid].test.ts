import handler from '@/pages/api/stremio-pm/cast/series/[imdbid]';
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
const episode = (name: string, size = 100) => ({
	path: `Show.S01/${name}`,
	size,
	link: `https://cdn/${name}`,
	stream_link: null,
});

const post = (body: Record<string, unknown>) =>
	createMockRequest({
		method: 'POST',
		query: { imdbid: 'tt999' },
		headers: { authorization: 'Bearer pm-key' },
		body,
	});

describe('/api/stremio-pm/cast/series/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		vi.mocked(generatePremiumizeUserId).mockResolvedValue('pm-user-1');
		mockRepository.savePremiumizeCast = vi.fn().mockResolvedValue(undefined);
	});

	it('rejects a GET', async () => {
		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt999' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(405);
	});

	// Episodes are addressed by filename, not by index: a positional index is
	// exactly what makes the other providers cast the wrong episode.
	it('resolves the release once and files each episode under its own key', async () => {
		mockDirectDl.mockResolvedValue([
			episode('Show.S01E01.mkv'),
			episode('Show.S01E02.mkv'),
			episode('Show.S01E03.mkv'),
		] as any);

		await handler(post({ hash: HASH, filenames: ['Show.S01E03.mkv', 'Show.S01E01.mkv'] }), res);

		expect(mockDirectDl).toHaveBeenCalledTimes(1);
		expect(mockRepository.savePremiumizeCast).toHaveBeenNthCalledWith(
			1,
			'tt999:1:3',
			'pm-user-1',
			HASH,
			'Show.S01E03.mkv',
			expect.any(Number),
			'Show.S01/Show.S01E03.mkv'
		);
		expect(mockRepository.savePremiumizeCast).toHaveBeenNthCalledWith(
			2,
			'tt999:1:1',
			'pm-user-1',
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
		mockDirectDl.mockResolvedValue([episode('Unnamed.mkv')] as any);

		await handler(post({ hash: HASH, filenames: ['Unnamed.mkv'] }), res);

		expect(mockRepository.savePremiumizeCast).not.toHaveBeenCalled();
		expect((res._getData() as any).errorEpisodes).toEqual([
			'Unnamed.mkv (no episode number in filename)',
		]);
	});

	it('reports a file that is not in the release instead of casting a neighbour', async () => {
		mockDirectDl.mockResolvedValue([episode('Show.S01E01.mkv')] as any);

		await handler(post({ hash: HASH, filenames: ['Show.S09E99.mkv'] }), res);

		expect(mockRepository.savePremiumizeCast).not.toHaveBeenCalled();
		expect((res._getData() as any).status).toBe('partial');
	});

	it('validates the request body', async () => {
		await handler(post({ hash: HASH }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});
});
