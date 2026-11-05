import recorded from '@/test/fixtures/allDebridAvailable/available-ad-files.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability';

const upsert = vi.fn();
const findUnique = vi.fn();
vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn().mockImplementation(function () {
		return { availableAd: { upsert, findUnique }, $disconnect: vi.fn() };
	}),
}));

// Production AvailableAdFile rows (2026-10-31): a Ready release with real /f/ links, and one
// that holds only the debridio marker a Debridio scrape leaves.
const [placeholder, remux, remuxTxt] = recorded.heat;
const sighting = (hash: string, files: Array<{ n: string; s: number; l: string }>) => ({
	hash,
	imdbId: 'tt0113277',
	filename: 'Heat.1995.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.5.1-FGT',
	size: files.reduce((sum, f) => sum + f.s, 0),
	status: 'Ready',
	statusCode: 4,
	completionDate: 1730000000,
	files,
});

describe('AvailabilityService AllDebrid Ready sightings', () => {
	let service: AvailabilityService;
	beforeEach(() => {
		vi.clearAllMocks();
		service = new AvailabilityService();
	});

	// A page could post a Ready sighting of any recorded release with links of its choosing,
	// and Stremio serves those links under the release's title.
	it('keeps the files of a release already Ready with real links', async () => {
		findUnique.mockResolvedValue({ status: 'Ready', files: [{ link: remux.link }] });
		await service.upsertAvailabilityAd(
			sighting(remux.hash, [
				{
					n: remux.path,
					s: Number(remux.bytes),
					l: 'https://alldebrid.com/f/' + 'x'.repeat(43),
				},
			])
		);
		const { update, create } = upsert.mock.calls[0][0];
		expect(update).not.toHaveProperty('files');
		expect(update.verificationCount).toEqual({ increment: 1 });
		expect(create.files.create).toHaveLength(1);
	});

	it('takes the files of a release held only as a Debridio marker, or not held Ready', async () => {
		for (const existing of [
			{ status: 'Ready', files: [] }, // the marker is not a real link
			{ status: 'Not instant', files: [] },
			null,
		]) {
			upsert.mockClear();
			findUnique.mockResolvedValue(existing);
			await service.upsertAvailabilityAd(
				sighting(placeholder.hash, [
					{ n: remux.path, s: Number(remux.bytes), l: remux.link },
				])
			);
			expect(upsert.mock.calls[0][0].update.files.create).toHaveLength(1);
		}
	});

	// AvailableAdFile.link is the table's key: two files sent without a link both became ''
	it('gives each file without a link a key of its own', async () => {
		findUnique.mockResolvedValue(null);
		await service.upsertAvailabilityAd(
			sighting(remux.hash, [
				{ n: remux.path, s: Number(remux.bytes), l: '' },
				{ n: remuxTxt.path, s: Number(remuxTxt.bytes), l: '' },
			])
		);
		const links = upsert.mock.calls[0][0].create.files.create.map((f: any) => f.link);
		expect(new Set(links).size).toBe(2);
		expect(links.every((l: string) => l.length > 0 && !l.startsWith('https://'))).toBe(true);
	});
});
