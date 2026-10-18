import { describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/exe-fakes-alldebrid.json';
import { AvailabilityService } from './database/availability';
import { Repository } from './repository';
import { resetBlocklistForTests, setBlocklistForTests } from './takedown/blocklist';

// The Resident Evil and The Odyssey (2026) pages as served on 2026-10-18 showed
// eight fakes under clean video titles. Only AllDebrid had cached them, each as a
// lone .exe or .scr, so the RD-only file check let every one through.
const filesOf =
	(table: Record<string, string[]>) =>
	async ({ where }: any) =>
		(where.hash.in as string[])
			.filter((hash) => table[hash])
			.map((hash) => ({ hash, files: table[hash].map((path) => ({ path })) }));
const { rdFindMany, adFindMany } = vi.hoisted(() => ({
	rdFindMany: vi.fn(),
	adFindMany: vi.fn(),
}));
rdFindMany.mockImplementation(filesOf(fixture.rdFiles as Record<string, string[]>));
adFindMany.mockImplementation(filesOf(fixture.adFiles as Record<string, string[]>));
vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn().mockImplementation(() => ({
		available: { findMany: rdFindMany },
		availableAd: { findMany: adFindMany },
	})),
}));

const AD_FAKES = [
	'08935f176feb7345d36d99ee4f6effdb766729b8',
	'09727c100dd8d4df89cab72ecaa7430a1adfda8a',
	'223913a3a93c74852b3949d46375dd237332b2e7',
	'3cacfce3e96b1d97abf52fa1c9d52f728ad1571f',
	'520f5c178083c539a9fea4145f75f26f56ae20f7',
	'5c94a84cb4aafee2ce3f9bb50d88da5e141b0d21',
	'6ef5c1d1dc1f24dac12004301a9455206d2f0c4e',
	'd3b6d11038544f229288c58a02248b609e418127',
];

describe('Repository drops executable fakes only AllDebrid has cached', () => {
	it('drops every AD exe-only hash from real pages and keeps the rest', async () => {
		setBlocklistForTests([]);
		const repo = new Repository({
			availabilityService: new AvailabilityService(),
			scrapedService: { getScrapedResults: vi.fn(async () => fixture.results) } as any,
		});
		const got = (await repo.getScrapedResults<any[]>('movie:tt35538033')) ?? [];
		expect(fixture.results.filter((row) => AD_FAKES.includes(row.hash))).toHaveLength(8);
		expect(got.filter((row) => AD_FAKES.includes(row.hash))).toEqual([]);
		expect(got).toHaveLength(fixture.results.length - 8);
		resetBlocklistForTests();
	});
});
