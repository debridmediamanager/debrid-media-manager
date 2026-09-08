import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SponsorProviderKeysService } from './sponsorProviderKeys';

const prismaMock = vi.hoisted(() => ({
	sponsorProviderKey: {
		findUnique: vi.fn(),
		findMany: vi.fn(),
		upsert: vi.fn(),
		deleteMany: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

const KEY = 'tb-live-' + 'k'.repeat(24);

describe('SponsorProviderKeysService', () => {
	let service: SponsorProviderKeysService;

	beforeEach(() => {
		service = new SponsorProviderKeysService();
		for (const fn of Object.values(prismaMock.sponsorProviderKey)) (fn as Mock).mockReset();
	});

	describe('getKey', () => {
		it('reads the key for one sponsor and one service', async () => {
			(prismaMock.sponsorProviderKey.findUnique as Mock).mockResolvedValue({ apiKey: KEY });

			await expect(service.getKey('ZP1M', 'tb')).resolves.toBe(KEY);
			expect(prismaMock.sponsorProviderKey.findUnique).toHaveBeenCalledWith({
				where: { shortId_service: { shortId: 'ZP1M', service: 'tb' } },
				select: { apiKey: true },
			});
		});

		it('answers null rather than querying for an empty sponsor', async () => {
			await expect(service.getKey('', 'tb')).resolves.toBeNull();
			expect(prismaMock.sponsorProviderKey.findUnique).not.toHaveBeenCalled();
		});

		it('answers null when nothing is linked', async () => {
			(prismaMock.sponsorProviderKey.findUnique as Mock).mockResolvedValue(null);

			await expect(service.getKey('ZP1M', 'pm')).resolves.toBeNull();
		});
	});

	describe('listLinked', () => {
		// The panel needs to say which key is linked without putting a working
		// credential on a screen someone is sharing.
		it('masks every key it returns', async () => {
			(prismaMock.sponsorProviderKey.findMany as Mock).mockResolvedValue([
				{ service: 'tb', apiKey: KEY, updatedAt: new Date('2026-09-09') },
			]);

			const linked = await service.listLinked('ZP1M');

			expect(linked[0].hint).not.toContain(KEY.slice(8));
			expect(linked[0].hint).toContain('•');
			expect(JSON.stringify(linked)).not.toContain(KEY);
		});

		// A row for a service this build no longer offers has no label and no
		// unlink button, so surfacing it would be a dead entry.
		it('drops a row for a service it does not know', async () => {
			(prismaMock.sponsorProviderKey.findMany as Mock).mockResolvedValue([
				{ service: 'tb', apiKey: KEY, updatedAt: new Date() },
				{ service: 'zz', apiKey: KEY, updatedAt: new Date() },
			]);

			const linked = await service.listLinked('ZP1M');

			expect(linked.map((row) => row.service)).toEqual(['tb']);
		});

		it('returns nothing for an empty sponsor without querying', async () => {
			await expect(service.listLinked('')).resolves.toEqual([]);
			expect(prismaMock.sponsorProviderKey.findMany).not.toHaveBeenCalled();
		});
	});

	describe('setKey', () => {
		it('replaces an existing link rather than failing on the key', async () => {
			await service.setKey('ZP1M', 'oc', KEY);

			expect(prismaMock.sponsorProviderKey.upsert).toHaveBeenCalledWith({
				where: { shortId_service: { shortId: 'ZP1M', service: 'oc' } },
				update: { apiKey: KEY },
				create: { shortId: 'ZP1M', service: 'oc', apiKey: KEY },
			});
		});
	});

	describe('removeKey', () => {
		it('reports whether anything was linked', async () => {
			(prismaMock.sponsorProviderKey.deleteMany as Mock).mockResolvedValue({ count: 1 });
			await expect(service.removeKey('ZP1M', 'pm')).resolves.toBe(true);

			(prismaMock.sponsorProviderKey.deleteMany as Mock).mockResolvedValue({ count: 0 });
			await expect(service.removeKey('ZP1M', 'pm')).resolves.toBe(false);
		});
	});
});
