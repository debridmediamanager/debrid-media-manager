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
const H1 = 'a'.repeat(40);
const H2 = 'B'.repeat(40);
const key = (name: string) => createHash('sha1').update(name).digest('hex');

const confident = (imdbId: string, title: string, year: number) => ({
	confident: true,
	matches: [{ imdbId, title, year, score: 4.2 }],
});

async function call(body: unknown) {
	const req = createMockRequest({ method: 'POST', body });
	const res = createMockResponse();
	await handler(req, res);
	return res;
}

describe('/api/library/identify', () => {
	beforeEach(() => {
		mockRepository.getFilenameIdentifications = vi.fn().mockResolvedValue([]);
		mockRepository.saveFilenameIdentifications = vi.fn().mockResolvedValue(1);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('refuses bodies that are not 1-500 named items', async () => {
		expect((await call({})).status).toHaveBeenCalledWith(400);
		expect((await call({ items: [] })).status).toHaveBeenCalledWith(400);
		expect((await call({ items: [{ hash: H1 }] })).status).toHaveBeenCalledWith(400);
		const tooMany = Array.from({ length: MAX_ITEMS + 1 }, () => ({ filename: MAD_MAX }));
		expect((await call({ items: tooMany })).status).toHaveBeenCalledWith(400);
		expect(mockIdentify).not.toHaveBeenCalled();
	});

	it('answers stored releases without asking the identifier', async () => {
		mockRepository.getFilenameIdentifications = vi.fn().mockResolvedValue([
			{
				hash: H1,
				titleKey: key(MAD_MAX),
				filename: MAD_MAX,
				imdbId: 'tt1392190',
				title: 'Mad Max: Fury Road',
				year: 2015,
				score: 4.2,
				confident: true,
			},
		]);
		const res = await call({ items: [{ hash: H1, filename: MAD_MAX }] });

		expect(mockRepository.getFilenameIdentifications).toHaveBeenCalledWith([
			{ hash: H1, titleKey: key(MAD_MAX) },
		]);
		expect(mockIdentify).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			results: [{ imdbId: 'tt1392190', title: 'Mad Max: Fury Road', year: 2015 }],
			complete: true,
		});
	});

	it('asks about the rest, returns only confident answers and stores every hashed one', async () => {
		mockIdentify.mockResolvedValue([
			confident('tt10954600', 'Ant-Man and the Wasp: Quantumania', 2023),
			{
				confident: false,
				matches: [{ imdbId: 'tt0000001', title: 'Le Million', year: 1931, score: 0.1 }],
			},
		]);
		const res = await call({
			items: [
				{ hash: H2, filename: QUANTUMANIA },
				{ hash: H1, filename: SAMPLE },
				{ filename: QUANTUMANIA }, // hashless (Premiumize): answered, not stored
			],
		});

		// one question per distinct filename
		expect(mockIdentify).toHaveBeenCalledWith([QUANTUMANIA, SAMPLE]);
		expect(res.json).toHaveBeenCalledWith({
			results: [
				{ imdbId: 'tt10954600', title: 'Ant-Man and the Wasp: Quantumania', year: 2023 },
				null,
				{ imdbId: 'tt10954600', title: 'Ant-Man and the Wasp: Quantumania', year: 2023 },
			],
			complete: true,
		});
		expect(mockRepository.saveFilenameIdentifications).toHaveBeenCalledWith([
			expect.objectContaining({
				hash: H2.toLowerCase(),
				titleKey: key(QUANTUMANIA),
				imdbId: 'tt10954600',
				confident: true,
			}),
			expect.objectContaining({ hash: H1, imdbId: 'tt0000001', confident: false }),
		]);
	});

	it('still serves stored answers when the identifier is down', async () => {
		mockRepository.getFilenameIdentifications = vi.fn().mockResolvedValue([
			{
				hash: H1,
				titleKey: key(MAD_MAX),
				filename: MAD_MAX,
				imdbId: 'tt1392190',
				title: 'Mad Max: Fury Road',
				year: 2015,
				score: 4.2,
				confident: true,
			},
		]);
		mockIdentify.mockResolvedValue(null);
		const res = await call({
			items: [
				{ hash: H1, filename: MAD_MAX },
				{ hash: H2, filename: QUANTUMANIA },
			],
		});

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [{ imdbId: 'tt1392190', title: 'Mad Max: Fury Road', year: 2015 }, null],
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
