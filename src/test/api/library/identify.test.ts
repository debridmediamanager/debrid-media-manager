import handler, { MAX_ITEMS } from '@/pages/api/library/identify';
import { identifyFilenames } from '@/services/contentIdentifier';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/contentIdentifier');

const mockRepository = vi.mocked(repository);
const mockIdentify = vi.mocked(identifyFilenames);

// real library names; the second is a sequel DMM users had filed under the original
const MAD_MAX =
	'Mad.Max.Fury.Road.2015.2160p.BluRay.x265.10bit.SDR.DTS-HD.MA.TrueHD.7.1.Atmos-SWTYBLZ';
const QUANTUMANIA = 'Ant-Man.and.the.Wasp.Quantumania.2023.2160p.MA.WEB-DL.DDP5.1.Atmos.DV.HDR10';
const SAMPLE = '00000';
// from ymsita's RD library (2026-10-11): an episode the library filed as a movie, and a
// Russian title the identifier ranked right but not confidently (p 0.46), which
// AvailableAd maps to the same film by hash
const TOWER = '[SubsPlease] Tower of God S2 - 01 (1080p) [D0A6D666].mkv';
const DURACKAJA = 'Eta-durackaja-ljubov.2011.MPEG-4-AVC.BluRay-Remux(1080p).mkv';
const DURACKAJA_HASH = '71aaba52718e52ca9f9b3744291a7f1c28cf93a2';
const H1 = 'a'.repeat(40);
const H2 = 'B'.repeat(40);
const key = (name: string) => createHash('sha1').update(`auto:${name}`).digest('hex');

const confident = (
	imdbId: string,
	title: string,
	year: number,
	kind: 'movie' | 'tv' = 'movie'
) => ({
	kind,
	probability: 0.97,
	confident: true,
	matches: [{ imdbId, title, year, score: 4.2 }],
});

async function call(body: unknown) {
	const req = createMockRequest({ method: 'POST', body });
	const res = createMockResponse();
	await handler(req, res);
	return res;
}

const storedMadMax = {
	hash: H1,
	titleKey: key(MAD_MAX),
	filename: MAD_MAX,
	kind: 'movie',
	imdbId: 'tt1392190',
	title: 'Mad Max: Fury Road',
	year: 2015,
	score: 0.99,
	confident: true,
};

describe('/api/library/identify', () => {
	beforeEach(() => {
		mockRepository.getFilenameIdentifications = vi.fn().mockResolvedValue([]);
		mockRepository.saveFilenameIdentifications = vi.fn().mockResolvedValue(1);
		mockRepository.getHashTitleIds = vi.fn().mockResolvedValue(new Map());
		mockRepository.confirmFilenameIdentifications = vi.fn().mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('refuses bodies that are not 1-500 named items', async () => {
		expect((await call({})).status).toHaveBeenCalledWith(400);
		expect((await call({ items: [] })).status).toHaveBeenCalledWith(400);
		expect((await call({ items: [{ hash: H1 }] })).status).toHaveBeenCalledWith(400);
		expect(
			(await call({ items: [{ filename: MAD_MAX, kind: 'music' }] })).status
		).toHaveBeenCalledWith(400);
		const tooMany = Array.from({ length: MAX_ITEMS + 1 }, () => ({ filename: MAD_MAX }));
		expect((await call({ items: tooMany })).status).toHaveBeenCalledWith(400);
		expect(mockIdentify).not.toHaveBeenCalled();
	});

	it('answers stored releases without asking the identifier', async () => {
		mockRepository.getFilenameIdentifications = vi.fn().mockResolvedValue([storedMadMax]);
		// an older page still sends its guess; it changes nothing
		const res = await call({ items: [{ hash: H1, filename: MAD_MAX, kind: 'movie' }] });

		expect(mockRepository.getFilenameIdentifications).toHaveBeenCalledWith([
			{ hash: H1, titleKey: key(MAD_MAX) },
		]);
		expect(mockIdentify).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			results: [
				{ imdbId: 'tt1392190', title: 'Mad Max: Fury Road', year: 2015, kind: 'movie' },
			],
			complete: true,
		});
	});

	it('asks once for movies and shows alike and returns the kind the service found', async () => {
		mockIdentify.mockResolvedValue([
			confident('tt10954600', 'Ant-Man and the Wasp: Quantumania', 2023),
			confident('tt12057106', 'Tower of God', 2020, 'tv'),
			{
				kind: 'movie',
				probability: 0.01,
				confident: false,
				matches: [{ imdbId: 'tt0000001', title: 'Le Million', year: 1931, score: 0.1 }],
			},
		]);
		const res = await call({
			items: [
				{ hash: H2, filename: QUANTUMANIA },
				{ hash: H1, filename: TOWER },
				{ filename: SAMPLE }, // hashless (Premiumize): answered, not stored
				{ filename: QUANTUMANIA },
			],
		});

		// one question per distinct filename
		expect(mockIdentify).toHaveBeenCalledExactlyOnceWith([QUANTUMANIA, TOWER, SAMPLE]);
		const quantumania = {
			imdbId: 'tt10954600',
			title: 'Ant-Man and the Wasp: Quantumania',
			year: 2023,
			kind: 'movie',
		};
		expect(res.json).toHaveBeenCalledWith({
			results: [
				quantumania,
				{ imdbId: 'tt12057106', title: 'Tower of God', year: 2020, kind: 'tv' },
				null,
				quantumania,
			],
			complete: true,
		});
		expect(mockRepository.saveFilenameIdentifications).toHaveBeenCalledWith([
			expect.objectContaining({
				hash: H2.toLowerCase(),
				titleKey: key(QUANTUMANIA),
				kind: 'movie',
				imdbId: 'tt10954600',
				score: 0.97,
				confident: true,
			}),
			expect.objectContaining({
				hash: H1,
				kind: 'tv',
				imdbId: 'tt12057106',
				confident: true,
			}),
		]);
	});

	it('names a release the service ranked first but doubted when DMM maps its hash there', async () => {
		const doubted = (imdbId: string, title: string) => ({
			kind: 'movie' as const,
			probability: 0.46,
			confident: false,
			matches: [{ imdbId, title, year: 2011, score: -0.02 }],
		});
		mockIdentify.mockResolvedValue([
			doubted('tt1570728', 'Crazy, Stupid, Love.'),
			doubted('tt0000002', 'Someone Else'),
		]);
		mockRepository.getHashTitleIds = vi.fn().mockResolvedValue(
			new Map([
				[DURACKAJA_HASH, new Set(['tt1541874', 'tt1570728'])],
				[H1, new Set(['tt9999999'])],
			])
		);
		const res = await call({
			items: [
				{ hash: DURACKAJA_HASH, filename: DURACKAJA },
				{ hash: H1, filename: 'Some.Other.2011' },
			],
		});

		expect(mockRepository.getHashTitleIds).toHaveBeenCalledWith([DURACKAJA_HASH, H1]);
		expect(res.json).toHaveBeenCalledWith({
			results: [
				{ imdbId: 'tt1570728', title: 'Crazy, Stupid, Love.', year: 2011, kind: 'movie' },
				null,
			],
			complete: true,
		});
		expect(mockRepository.saveFilenameIdentifications).toHaveBeenCalledWith([
			expect.objectContaining({ hash: DURACKAJA_HASH, confident: true }),
			expect.objectContaining({ hash: H1, confident: false }),
		]);
	});

	it('does not take an agreement the filename year contradicts', async () => {
		// the service ranked the 1992 sequel first; a mis-filed Available row agrees with it
		const PET =
			'Pet.Sematary.2019.PROPER.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos-FGT.mkv';
		const PET_HASH = '40f606ca3aa415cd4b94905012f167823274b8fe';
		mockIdentify.mockResolvedValue([
			{
				kind: 'movie',
				probability: 0.04,
				parsedYear: 2019,
				confident: false,
				matches: [
					{ imdbId: 'tt0105128', title: 'Pet Sematary II', year: 1992, score: 3.44 },
				],
			},
		]);
		mockRepository.getHashTitleIds = vi
			.fn()
			.mockResolvedValue(
				new Map([[PET_HASH, new Set(['tt0837563', 'tt0105128', 'tt0098084'])]])
			);
		const res = await call({ items: [{ hash: PET_HASH, filename: PET }] });
		expect(res.json).toHaveBeenCalledWith({ results: [null], complete: true });
	});

	// ymsita's library, 2026-10-12: a One Piece Log episode stored as doubted the day
	// before TorrentSnapshot joined the hash map; without a second look it stayed unnamed
	it('asks again about a doubted stored answer the hash map has come to back', async () => {
		const LOG = '[SubsPlease] One Piece Log - Fish-Man Island Saga - 03 (1080p) [B9C6C448].mkv';
		const LOG_HASH = '6ca1db218506e01169db19d971dfb7b967c1182a';
		const doubtedRow = (hash: string, filename: string, imdbId: string) => ({
			hash,
			titleKey: key(filename),
			filename,
			kind: 'tv',
			imdbId,
			title: 'One Piece Log: Fish-Man Island Saga',
			year: 2024,
			score: 0.57,
			confident: false,
		});
		mockRepository.getFilenameIdentifications = vi
			.fn()
			.mockResolvedValue([
				doubtedRow(LOG_HASH, LOG, 'tt33992229'),
				doubtedRow(H1, 'Unbacked.S01', 'tt0000009'),
			]);
		mockRepository.getHashTitleIds = vi
			.fn()
			.mockResolvedValue(new Map([[LOG_HASH, new Set(['tt0388629', 'tt33992229'])]]));
		mockIdentify.mockResolvedValue([
			{
				kind: 'tv',
				probability: 0.57,
				parsedYear: null,
				confident: false,
				matches: [
					{
						imdbId: 'tt33992229',
						title: 'One Piece Log: Fish-Man Island Saga',
						year: 2024,
						score: 1,
					},
				],
			},
		]);

		const res = await call({
			items: [
				{ hash: LOG_HASH, filename: LOG },
				{ hash: H1, filename: 'Unbacked.S01' },
			],
		});

		// only the backed row is asked again; the other stays a stored doubt
		expect(mockIdentify).toHaveBeenCalledExactlyOnceWith([LOG]);
		expect(res.json).toHaveBeenCalledWith({
			results: [
				{
					imdbId: 'tt33992229',
					title: 'One Piece Log: Fish-Man Island Saga',
					year: 2024,
					kind: 'tv',
				},
				null,
			],
			complete: true,
		});
		expect(mockRepository.confirmFilenameIdentifications).toHaveBeenCalledWith([
			expect.objectContaining({ hash: LOG_HASH, titleKey: key(LOG), confident: true }),
		]);
	});

	it('still serves stored answers when the identifier is down', async () => {
		mockRepository.getFilenameIdentifications = vi.fn().mockResolvedValue([storedMadMax]);
		mockIdentify.mockResolvedValue(null);
		const res = await call({
			items: [
				{ hash: H1, filename: MAD_MAX },
				{ hash: H2, filename: QUANTUMANIA },
			],
		});

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [
				{ imdbId: 'tt1392190', title: 'Mad Max: Fury Road', year: 2015, kind: 'movie' },
				null,
			],
			complete: false,
		});
		expect(mockRepository.saveFilenameIdentifications).toHaveBeenCalledWith([]);
	});

	it('does not fail the answer when storing fails', async () => {
		mockIdentify.mockResolvedValue([confident('tt1392190', 'Mad Max: Fury Road', 2015)]);
		mockRepository.saveFilenameIdentifications = vi
			.fn()
			.mockRejectedValue(new Error('deadlock'));
		const res = await call({ items: [{ hash: H1, filename: MAD_MAX }] });
		expect(res.status).toHaveBeenCalledWith(200);
	});
});
