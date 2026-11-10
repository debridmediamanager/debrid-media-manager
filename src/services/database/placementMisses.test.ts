import { placeOnePace, type OnePaceCatalogue } from '@/services/onePace';
import onePaceList from '@/services/onePaceCatalogue.json';
import type { PlacedRelease, PlaceRequest } from '@/services/placement';
import onePaceFun from '@/test/fixtures/onepace/fun-releases-2026-11-09.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import live from '../__fixtures__/place-misses-2026-11-09.json';
import { placementMisses, PlacementMissService } from './placementMisses';

const requests: PlaceRequest[] = live.request.releases.map((release) => ({
	...release,
	imdbId: release.imdbId ?? null,
}));
const answers = live.answer.releases as PlacedRelease[];
const named = (name: string) => requests.findIndex((r) => r.name.startsWith(name));

describe('placementMisses', () => {
	// production's answers of 2026-11-09 for four of fun's releases
	it("keeps what DMM's live answers left unplaced, and settles what they placed", () => {
		const { missed, placed } = placementMisses(requests, answers);

		expect(missed.map((row) => [row.name.slice(0, 26), row.kind, row.files])).toEqual([
			['The Winchesters (2022) S01', 'tv', ['Deleted Scenes.mkv']],
			[
				'Yellow Mirror 2026 1080p D',
				null,
				['Yellow Mirror 2026 1080p DSNP WEB.DL DDP5.1 H.264-OldT.mkv'],
			],
		]);
		expect(missed[0]).toMatchObject({ imdbId: 'tt14923244', fileCount: 14 });
		expect(missed[0].hash).toBe(requests[named('The Winchesters')].hash);
		// Evil's episode, and X-Men: First Class, a film whose file names no episode
		expect(placed).toHaveLength(2);
	});

	// fun's One Pace releases (2026-11-09) as One Pace's list numbers them: a file the series
	// numbers is placed, as zurg counts it, and one of an older cut is kept as a miss
	it('settles a One Pace release whose files One Pace numbers, and keeps the rest', () => {
		const pace = onePaceFun.releases as PlaceRequest[];
		const answered = pace.map((release) =>
			placeOnePace(release, onePaceList as OnePaceCatalogue)
		);
		const water = pace.findIndex((r) => r.name.includes('Water Seven 08'));
		expect(placementMisses([pace[water]], [answered[water]])).toEqual({
			missed: [],
			placed: [expect.any(String)],
		});
		const { missed } = placementMisses(pace, answered);
		expect(missed.find((row) => row.name.includes('Baratie 03'))?.files).toEqual([
			'[One Pace][47-49] Baratie 03 [1080p][0EB7F7E9].mkv',
		]);
		expect(missed.reduce((n, row) => n + row.files.length, 0)).toBe(464 - 452);
	});

	it('leaves a skipped release alone: zurg asks again', () => {
		const at = named('Yellow Mirror');
		const { missed, placed } = placementMisses(
			[requests[at]],
			[{ ...answers[at], skipped: true }]
		);
		expect(missed).toEqual([]);
		expect(placed).toEqual([]);
	});

	it('keeps a release asked in two parts as one miss, even when one part placed', () => {
		const at = named('The Winchesters');
		const half = requests[at].files.length / 2;
		const parts = [
			{ ...requests[at], files: requests[at].files.slice(0, half) },
			{ ...requests[at], files: requests[at].files.slice(half) },
		];
		const placedPart = {
			...answers[at],
			files: answers[at].files.filter((f) => f.episode !== null),
		};
		const { missed, placed } = placementMisses(parts, [answers[at], placedPart]);
		expect(missed).toHaveLength(1);
		expect(missed[0].fileCount).toBe(requests[at].files.length);
		expect(placed).toEqual([]);
	});

	it('tells the films of a collection apart: each is asked under the pack hash', () => {
		const at = named('X-Men');
		const other = { ...requests[at], name: 'X2.2003.mkv' };
		const unknown = { kind: null, imdbId: null, tmdbId: null, files: answers[at].files };
		const { missed, placed } = placementMisses([requests[at], other], [answers[at], unknown]);
		expect(missed.map((row) => row.name)).toEqual(['X2.2003.mkv']);
		expect(placed).toHaveLength(1);
		expect(placed[0]).not.toBe(missed[0].id);
	});
});

describe('PlacementMissService.record', () => {
	let service: PlacementMissService;
	let prisma: any;

	beforeEach(() => {
		prisma = { placementMiss: { deleteMany: vi.fn() }, $executeRaw: vi.fn() };
		service = new PlacementMissService();
		(service as any).prisma = prisma;
	});

	it('drops the placed releases and counts each miss once more', async () => {
		await service.record(requests, answers, '2026-11-04.1');

		expect(prisma.placementMiss.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: placementMisses(requests, answers).placed } },
		});
		const [sql] = prisma.$executeRaw.mock.calls[0];
		const text = sql.join('?');
		expect(text).toContain('INSERT INTO PlacementMiss');
		expect(text).toContain('asks = asks + 1');
		expect(prisma.$executeRaw.mock.calls[0].flat()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ values: expect.arrayContaining(['2026-11-04.1']) }),
			])
		);
	});

	it('writes nothing when every release placed', async () => {
		const at = named('Evil');
		await service.record([requests[at]], [answers[at]], 'r');
		expect(prisma.$executeRaw).not.toHaveBeenCalled();
	});
});
