import { describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/exe-fakes.json';
import { AvailabilityService } from './database/availability';
import { Repository } from './repository';
import { resetBlocklistForTests, setBlocklistForTests } from './takedown/blocklist';

// Card 383: a real It's Always Sunny S18 page (dmmdb, 2026-10-14) holds nine
// fakes whose titles look like video and whose RD-cached file is a lone .exe.
const rdFiles = fixture.rdFiles as Record<string, string[]>;
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
findMany.mockImplementation(async ({ where }: any) =>
	(where.hash.in as string[])
		.filter((hash) => rdFiles[hash])
		.map((hash) => ({ hash, files: rdFiles[hash].map((path) => ({ path })) }))
);
vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn().mockImplementation(() => ({
		available: { findMany },
		availableAd: { findMany: async () => [] },
	})),
}));

const FAKES = Object.entries(rdFiles)
	.filter(([, paths]) => paths.every((path) => path.endsWith('.exe')))
	.map(([hash]) => hash);

const build = (results: unknown[]) =>
	new Repository({
		availabilityService: new AvailabilityService(),
		scrapedService: {
			getScrapedTrueResults: vi.fn(async () => results),
			getScrapedResults: vi.fn(async () => results),
		} as any,
	});

describe('Repository drops executable fakes', () => {
	it('drops every exe-only hash from a real page and keeps the rest', async () => {
		setBlocklistForTests([]);
		const got =
			(await build(fixture.results).getScrapedTrueResults<any[]>('tv:tt0472954:18')) ?? [];
		expect(FAKES).toHaveLength(9);
		expect(got.filter((row) => FAKES.includes(row.hash))).toEqual([]);
		expect(got).toHaveLength(fixture.results.length - 9);
		resetBlocklistForTests();
	});

	it('drops titles that end in exe, with or without the dot, even when the lookup fails', async () => {
		setBlocklistForTests([]);
		findMany.mockRejectedValueOnce(new Error('db down'));
		const kept = fixture.results[0];
		const got =
			(await build([...fixture.titleOnly, kept]).getScrapedResults<any[]>('movie:tt1')) ?? [];
		expect(got).toEqual([kept]);
		resetBlocklistForTests();
	});
});
