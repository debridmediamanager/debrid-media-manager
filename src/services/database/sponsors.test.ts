import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SponsorsService } from './sponsors';

const prismaMock = vi.hoisted(() => ({
	sponsors: {
		findUnique: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

const KEY = 'a'.repeat(64);

const LAPSED = {
	shortId: 'ZP1M',
	githubUsername: 'someone',
	dmmApiKeyVersion: 1,
	githubSponsoring: false,
	patreonAmount: 0,
	oneTimeDonationEndDate: null,
};

describe('SponsorsService', () => {
	let service: SponsorsService;

	beforeEach(() => {
		service = new SponsorsService();
		(prismaMock.sponsors.findUnique as Mock).mockReset();
	});

	describe('getByDmmApiKey', () => {
		// The column holds a 64-char sha256 digest, so anything else cannot match
		// and must not reach the index.
		it.each([
			['', 'empty'],
			['short', 'too short'],
			[`${'a'.repeat(63)}Z`, 'non-hex'],
		])('rejects %s (%s) without querying', async (key) => {
			expect(await service.getByDmmApiKey(key)).toBeNull();
			expect(prismaMock.sponsors.findUnique).not.toHaveBeenCalled();
		});

		it('returns null when no sponsor holds the key', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue(null);
			expect(await service.getByDmmApiKey(KEY)).toBeNull();
		});

		it('looks the sponsor up by dmmApiKey', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue(null);
			await service.getByDmmApiKey(KEY);
			expect(prismaMock.sponsors.findUnique).toHaveBeenCalledWith(
				expect.objectContaining({ where: { dmmApiKey: KEY } })
			);
		});

		it('recognises a GitHub sponsor', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue({
				...LAPSED,
				githubSponsoring: true,
			});
			const result = await service.getByDmmApiKey(KEY);
			expect(result).toMatchObject({
				isSponsor: true,
				sources: ['github'],
				shortId: 'ZP1M',
				githubUsername: 'someone',
				keyVersion: 1,
			});
		});

		it('recognises a Patreon sponsor', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue({
				...LAPSED,
				patreonAmount: 500,
			});
			expect((await service.getByDmmApiKey(KEY))?.sources).toEqual(['patreon']);
		});

		it('recognises a one-time donation that has not run out', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue({
				...LAPSED,
				oneTimeDonationEndDate: new Date(Date.now() + 60_000),
			});
			expect((await service.getByDmmApiKey(KEY))?.sources).toEqual(['onetime']);
		});

		// A key outlives the sponsorship it was issued for, so "the key resolves"
		// must never be mistaken for "the sponsorship is live". This is exactly
		// what the DmmApiKeys table cannot tell us, and why we read Sponsors.
		it('resolves a lapsed sponsorship but does not call it a sponsor', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue({
				...LAPSED,
				oneTimeDonationEndDate: new Date(Date.now() - 60_000),
			});
			const result = await service.getByDmmApiKey(KEY);
			expect(result).not.toBeNull();
			expect(result?.isSponsor).toBe(false);
			expect(result?.sources).toEqual([]);
			expect(result?.githubUsername).toBe('someone');
		});

		it('reports every active source', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue({
				...LAPSED,
				githubSponsoring: true,
				patreonAmount: 300,
				oneTimeDonationEndDate: new Date(Date.now() + 60_000),
			});
			expect((await service.getByDmmApiKey(KEY))?.sources).toEqual([
				'github',
				'patreon',
				'onetime',
			]);
		});

		it('carries the key version through, so a reset can be detected', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue({
				...LAPSED,
				githubSponsoring: true,
				dmmApiKeyVersion: 4,
			});
			expect((await service.getByDmmApiKey(KEY))?.keyVersion).toBe(4);
		});
	});

	describe('getByShortId', () => {
		it('rejects an empty id without querying', async () => {
			expect(await service.getByShortId('')).toBeNull();
			expect(prismaMock.sponsors.findUnique).not.toHaveBeenCalled();
		});

		it('looks the sponsor up by shortId', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue({
				...LAPSED,
				githubSponsoring: true,
			});
			const result = await service.getByShortId('ZP1M');
			expect(prismaMock.sponsors.findUnique).toHaveBeenCalledWith(
				expect.objectContaining({ where: { shortId: 'ZP1M' } })
			);
			expect(result?.isSponsor).toBe(true);
		});

		it('returns null for an unknown id', async () => {
			(prismaMock.sponsors.findUnique as Mock).mockResolvedValue(null);
			expect(await service.getByShortId('ZZZZ')).toBeNull();
		});
	});
});
