import handler from '@/pages/api/torrents/tv-seasons';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockValidateProblemToken,
	mockGetAllScrapedTrueResults,
	mockGetReportedHashes,
	mockCheckAvailability,
	mockCheckCanary,
} = vi.hoisted(() => ({
	mockValidateProblemToken: vi.fn(),
	mockGetAllScrapedTrueResults: vi.fn(),
	mockGetReportedHashes: vi.fn(),
	mockCheckAvailability: vi.fn(),
	mockCheckCanary: vi.fn(),
}));

vi.mock('@/utils/problemToken', () => ({
	validateProblemToken: mockValidateProblemToken,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		getAllScrapedTrueResults: mockGetAllScrapedTrueResults,
		getReportedHashes: mockGetReportedHashes,
		checkAvailability: mockCheckAvailability,
	},
}));

vi.mock('@/utils/canaryGuard', () => ({
	checkCanary: mockCheckCanary,
	respondAsNeverScraped: vi.fn(),
}));

const hash = (marker: string) => marker.repeat(40).slice(0, 40);
const PACK = hash('a');
const OTHER_PACK = hash('b');
const EPISODE = hash('c');
const REPORTED = hash('d');

const row = (hash: string, title: string, fileSize = 40000) => ({ hash, title, fileSize });

const baseQuery = {
	imdbId: 'tt0306414',
	seasons: '3',
	dmmProblemKey: 'key',
	solution: 'solution',
};

const call = async (query: Record<string, unknown>) => {
	const req = createMockRequest({ query: query as never });
	const res = createMockResponse();
	await handler(req, res);
	return res;
};

describe('/api/torrents/tv-seasons', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateProblemToken.mockReturnValue(true);
		mockCheckCanary.mockResolvedValue(null);
		mockGetReportedHashes.mockResolvedValue([]);
		mockCheckAvailability.mockResolvedValue([]);
		mockGetAllScrapedTrueResults.mockResolvedValue([]);
	});

	it('refuses a request with no problem token', async () => {
		const res = await call({ imdbId: 'tt0306414', seasons: '3' });
		expect(res.status).toHaveBeenCalledWith(403);
	});

	it('refuses an invalid problem token', async () => {
		mockValidateProblemToken.mockReturnValue(false);
		const res = await call(baseQuery);
		expect(res.status).toHaveBeenCalledWith(403);
	});

	it('requires a well formed imdb id', async () => {
		expect((await call({ ...baseQuery, imdbId: 'notanid' })).status).toHaveBeenCalledWith(400);
		expect((await call({ ...baseQuery, imdbId: undefined })).status).toHaveBeenCalledWith(400);
	});

	it('requires a usable season list', async () => {
		expect((await call({ ...baseQuery, seasons: undefined })).status).toHaveBeenCalledWith(400);
		expect((await call({ ...baseQuery, seasons: 'three' })).status).toHaveBeenCalledWith(400);
		// Specials are excluded by the run; a zero here would read a row for nothing.
		expect((await call({ ...baseQuery, seasons: '0' })).status).toHaveBeenCalledWith(400);
		// Fifty is the cap, so fifty-one seasons is a refusal rather than fifty-one row reads.
		const tooMany = Array.from({ length: 51 }, (_, i) => i + 1).join(',');
		expect((await call({ ...baseQuery, seasons: tooMany })).status).toHaveBeenCalledWith(400);
	});

	it('answers a canary id as an unscraped title and reads no rows', async () => {
		mockCheckCanary.mockResolvedValue('trap');
		const res = await call(baseQuery);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual({ seasons: [] });
		expect(mockGetAllScrapedTrueResults).not.toHaveBeenCalled();
	});

	it('returns the packs for each requested season', async () => {
		mockGetAllScrapedTrueResults.mockImplementation(async (key: string) => {
			if (key === 'tt0306414:3') return [];
			if (key === 'tv:tt0306414:3') {
				return [
					row(PACK, 'The.Wire.S03.1080p.BluRay.x264-GROUP'),
					row(EPISODE, 'The.Wire.S03E04.1080p.BluRay.x264-GROUP', 3000),
				];
			}
			if (key === 'tv:tt0306414:4') {
				return [row(OTHER_PACK, 'The.Wire.S04.1080p.BluRay.x264-GROUP')];
			}
			return [];
		});

		const res = await call({ ...baseQuery, seasons: '3,4' });
		const data = res._getData() as any;

		expect(data.seasons).toHaveLength(2);
		expect(data.seasons[0].packs.map((p: any) => p.hash)).toEqual([PACK]);
		expect(data.seasons[1].packs.map((p: any) => p.hash)).toEqual([OTHER_PACK]);
		// Packs mode never pays for the per-episode payload.
		expect(data.seasons[0].episodes).toEqual({});
	});

	it('never offers a reported hash for an automated add', async () => {
		mockGetReportedHashes.mockResolvedValue([REPORTED]);
		mockGetAllScrapedTrueResults.mockResolvedValue([
			row(REPORTED, 'The.Wire.S03.1080p.REPACK-GROUP'),
			row(PACK, 'The.Wire.S03.1080p.BluRay.x264-GROUP'),
		]);

		const res = await call(baseQuery);
		const data = res._getData() as any;
		expect(data.seasons[0].packs.map((p: any) => p.hash)).toEqual([PACK]);
	});

	it('counts videos rather than files when reporting a pack size', async () => {
		mockGetAllScrapedTrueResults.mockResolvedValue([
			row(PACK, 'The.Wire.S03.1080p.BluRay.x264-GROUP'),
		]);
		mockCheckAvailability.mockResolvedValue([
			{
				hash: PACK,
				files: [
					{ file_id: 1, path: 'The.Wire.S03E01.mkv', bytes: BigInt(1) },
					{ file_id: 2, path: 'The.Wire.S03E02.mkv', bytes: BigInt(1) },
					{ file_id: 3, path: 'The.Wire.S03E01.srt', bytes: BigInt(1) },
					{ file_id: 4, path: 'sample.mkv', bytes: BigInt(1) },
				],
			},
		]);

		const res = await call(baseQuery);
		const pack = (res._getData() as any).seasons[0].packs[0];
		// Subtitles and the sample are not episodes; counting files instead of
		// videos would put this release two over its real size and let a
		// two-episode pack pass as a four-episode season.
		expect(pack.videoCount).toBe(2);
		expect(pack.rdAvailable).toBe(true);
		expect(pack.files).toHaveLength(4);
	});

	it('marks a release RD has never held as unavailable', async () => {
		mockGetAllScrapedTrueResults.mockResolvedValue([
			row(PACK, 'The.Wire.S03.1080p.BluRay.x264-GROUP'),
		]);
		const res = await call(baseQuery);
		const pack = (res._getData() as any).seasons[0].packs[0];
		expect(pack.rdAvailable).toBe(false);
		expect(pack.videoCount).toBeUndefined();
	});

	it('reads availability once for the whole show, not once per season', async () => {
		// `Available` is keyed by imdb id rather than by season, so a per-season
		// split would cost twenty queries for the rows one query already holds.
		mockGetAllScrapedTrueResults.mockResolvedValue([
			row(PACK, 'The.Wire.S03.1080p.BluRay.x264-GROUP'),
		]);
		await call({ ...baseQuery, seasons: '1,2,3,4,5' });
		expect(mockCheckAvailability).toHaveBeenCalledTimes(1);
	});

	it('returns per-episode buckets only when asked for them', async () => {
		mockGetAllScrapedTrueResults.mockResolvedValue([
			row(PACK, 'The.Wire.S03.1080p.BluRay.x264-GROUP'),
			row(EPISODE, 'The.Wire.S03E04.1080p.BluRay.x264-GROUP', 3000),
		]);

		const res = await call({ ...baseQuery, mode: 'episodes' });
		const data = res._getData() as any;
		expect(data.seasons[0].packs).toEqual([]);
		expect(Object.keys(data.seasons[0].episodes)).toEqual(['4']);
		expect(data.seasons[0].episodes['4'][0].hash).toBe(EPISODE);
	});

	it('reads only the trusted pool', async () => {
		// `Scraped` carries fabricated titles on real hashes; an automated add
		// must never reach it, whatever the caller asks for.
		mockGetAllScrapedTrueResults.mockResolvedValue([]);
		await call({ ...baseQuery, onlyTrusted: 'false' });
		expect(mockGetAllScrapedTrueResults).toHaveBeenCalledWith('tv:tt0306414:3');
	});
});
