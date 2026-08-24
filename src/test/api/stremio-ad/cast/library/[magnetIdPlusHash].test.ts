import handler from '@/pages/api/stremio-ad/cast/library/[magnetIdPlusHash]';
import { getMagnetFiles, getMagnetStatusAd, isAdStatusReady } from '@/services/allDebrid';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateAllDebridUserId } from '@/utils/allDebridCastApiHelpers';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/allDebrid');
vi.mock('@/utils/allDebridCastApiHelpers');

const mockRepository = vi.mocked(repository);
const mockGetMagnetStatusAd = vi.mocked(getMagnetStatusAd);
const mockGetMagnetFiles = vi.mocked(getMagnetFiles);
const mockIsAdStatusReady = vi.mocked(isAdStatusReady);

const HASH = 'fbadffe5476df0674dbec75e81426895e40b6427';

const magnetFiles = (files: { n: string; s: number; l: string }[]) =>
	({ magnets: [{ files }] }) as any;

describe('/api/stremio-ad/cast/library/[magnetIdPlusHash]', () => {
	let res: ReturnType<typeof createMockResponse>;
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		res = createMockResponse();
		vi.mocked(generateAllDebridUserId).mockResolvedValue('user1');
		mockIsAdStatusReady.mockReturnValue(true);
		mockGetMagnetStatusAd.mockResolvedValue({ hash: HASH, filename: 'Some Movie 2021' } as any);
		mockRepository.getIMDBIdByHashAd = vi.fn().mockResolvedValue('tt1234567');
		mockRepository.saveIMDBIdMapping = vi.fn().mockResolvedValue(undefined);
		mockRepository.saveAllDebridCast = vi.fn().mockResolvedValue(undefined);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it('rejects a non-numeric magnet id', async () => {
		const req = createMockRequest({
			query: { magnetIdPlusHash: `abc:${HASH}`, apiKey: 'key' },
		});
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	// Regression: AllDebridCast is unique on (imdbId, userId, hash), so every
	// video file without a season/episode used to be written to the bare imdb id
	// and overwrite the one before it - only the last file survived.
	it('writes one row for a movie shipped with extras, and it is the feature', async () => {
		mockGetMagnetFiles.mockResolvedValue(
			magnetFiles([
				{ n: 'Trailer.mkv', s: 2_000_000, l: 'https://alldebrid.com/f/trailer' },
				{ n: 'Some Movie 2021.mkv', s: 90_000_000, l: 'https://alldebrid.com/f/movie' },
				{ n: 'Behind.The.Scenes.mkv', s: 8_000_000, l: 'https://alldebrid.com/f/bts' },
			])
		);

		const req = createMockRequest({ query: { magnetIdPlusHash: `42:${HASH}`, apiKey: 'key' } });
		await handler(req, res);

		expect(mockRepository.saveAllDebridCast).toHaveBeenCalledTimes(1);
		expect(mockRepository.saveAllDebridCast).toHaveBeenCalledWith(
			'tt1234567',
			'user1',
			HASH,
			'Some Movie 2021.mkv',
			'https://alldebrid.com/f/movie',
			86,
			42,
			// index into the name-sorted video list, which is what /play/ rebuilds:
			// Behind.The.Scenes, Some Movie, Trailer
			1
		);
	});

	it('gives every episode its own key and keeps its position in the sorted list', async () => {
		mockGetMagnetFiles.mockResolvedValue(
			magnetFiles([
				{ n: 'Show.S01E01.mkv', s: 100, l: 'https://alldebrid.com/f/e1' },
				{ n: 'Show.S01E02.mkv', s: 100, l: 'https://alldebrid.com/f/e2' },
			])
		);

		const req = createMockRequest({ query: { magnetIdPlusHash: `42:${HASH}`, apiKey: 'key' } });
		await handler(req, res);

		expect(mockRepository.saveAllDebridCast).toHaveBeenCalledTimes(2);
		expect(mockRepository.saveAllDebridCast).toHaveBeenNthCalledWith(
			1,
			'tt1234567:1:1',
			'user1',
			HASH,
			'Show.S01E01.mkv',
			'https://alldebrid.com/f/e1',
			expect.any(Number),
			42,
			0
		);
		expect(mockRepository.saveAllDebridCast).toHaveBeenNthCalledWith(
			2,
			'tt1234567:1:2',
			'user1',
			HASH,
			'Show.S01E02.mkv',
			'https://alldebrid.com/f/e2',
			expect.any(Number),
			42,
			1
		);
	});

	it('asks for an imdb id when the hash has no mapping yet', async () => {
		mockRepository.getIMDBIdByHashAd = vi.fn().mockResolvedValue(null);
		mockGetMagnetFiles.mockResolvedValue(
			magnetFiles([
				{ n: 'Some Movie 2021.mkv', s: 90_000_000, l: 'https://alldebrid.com/f/movie' },
			])
		);

		const req = createMockRequest({ query: { magnetIdPlusHash: `42:${HASH}`, apiKey: 'key' } });
		await handler(req, res);

		expect((res._getData() as any).status).toBe('need_imdb_id');
		expect(mockRepository.saveAllDebridCast).not.toHaveBeenCalled();
	});
});
