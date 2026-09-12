import { UserTorrentStatus, type UserTorrent } from '@/torrent/userTorrent';
import { filenameParse } from '@ctrl/video-filename-parser';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSeasonPackAdder, type SeasonAdderPlan } from './useSeasonPackAdder';

const { mockAxiosGet, mockCheckCachedStatus, mockHasRecentRdRateLimits } = vi.hoisted(() => ({
	mockAxiosGet: vi.fn(),
	mockCheckCachedStatus: vi.fn(),
	mockHasRecentRdRateLimits: vi.fn(() => false),
}));

vi.mock('axios', () => ({ default: { get: mockAxiosGet } }));
vi.mock('@/services/torbox', () => ({ checkCachedStatus: mockCheckCachedStatus }));
vi.mock('@/services/realDebrid', () => ({
	hasRecentRdRateLimits: mockHasRecentRdRateLimits,
}));
vi.mock('@/utils/token', () => ({
	generateTokenAndHash: vi.fn(async () => ['token-ts', 'token-hash']),
}));

const hash = (marker: string) => marker.repeat(40).slice(0, 40);

const candidate = (hash: string, title: string, videoCount?: number, episodes?: number[]) => ({
	hash,
	title,
	sizeMb: 5000,
	rdAvailable: true,
	videoCount,
	files: [{ fileId: 1, filename: `${title}.mkv`, filesize: 1 }],
	...(episodes ? { episodes } : {}),
});

const libraryRow = (name: string, service: 'rd' | 'tb' = 'rd'): UserTorrent => ({
	id: `${service}:${name}`,
	filename: name,
	title: name,
	hash: name.toLowerCase(),
	bytes: 1,
	progress: 100,
	status: UserTorrentStatus.finished,
	serviceStatus: 'downloaded',
	added: new Date('2026-09-01'),
	mediaType: 'tv',
	info: filenameParse(name, true),
	links: [],
	selectedFiles: [],
	seeders: 0,
	speed: 0,
});

const show = {
	title: 'The Wire',
	seasonCount: 3,
	episodeCounts: { 1: 10, 2: 10, 3: 10 },
	lastEpisodeToAir: null,
};

let addRd: ReturnType<typeof vi.fn>;
let addTb: ReturnType<typeof vi.fn>;

const render = (libraryItems: UserTorrent[] = []) =>
	renderHook(
		({ imdbId }: { imdbId: string }) =>
			useSeasonPackAdder({
				imdbId,
				show,
				libraryItems,
				hashAndProgress: {},
				addRd: addRd as never,
				addTb: addTb as never,
				episodeMaxSize: '0',
			}),
		{ initialProps: { imdbId: 'tt0306414' } }
	);

/** Answers the packs call, then the episodes call, from a per-season script. */
const respondWith = (script: {
	packs: Record<number, unknown[]>;
	episodes?: Record<number, Record<string, unknown[]>>;
}) => {
	mockAxiosGet.mockImplementation(async (_url: string, config: any) => {
		const seasons = String(config.params.seasons)
			.split(',')
			.map((s) => Number.parseInt(s, 10));
		if (config.params.mode === 'episodes') {
			return {
				data: {
					seasons: seasons.map((season) => ({
						season,
						packs: [],
						episodes: script.episodes?.[season] ?? {},
					})),
				},
			};
		}
		return {
			data: {
				seasons: seasons.map((season) => ({
					season,
					packs: script.packs[season] ?? [],
					episodes: {},
				})),
			},
		};
	});
};

describe('useSeasonPackAdder', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockHasRecentRdRateLimits.mockReturnValue(false);
		addRd = vi.fn(async () => true);
		addTb = vi.fn(async () => undefined);
	});

	it('plans a pack for every season that has one', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});

		expect(plan!.entries.map((e) => e.status)).toEqual(['pack', 'pack', 'pack']);
		expect(plan!.summary.totalAddCount).toBe(3);
		// One request; the per-episode payload is never fetched for a show whose
		// seasons all have packs.
		expect(mockAxiosGet).toHaveBeenCalledTimes(1);
	});

	it('skips a season the library already holds as a pack', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		const { result } = render([libraryRow('The.Wire.S02.1080p.BluRay.x264-GROUP')]);

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});

		expect(plan!.entries.map((e) => e.status)).toEqual(['pack', 'held', 'pack']);
		expect(plan!.summary.totalAddCount).toBe(2);
	});

	it('asks for episodes only for the seasons with no usable pack', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [],
				3: [],
			},
			episodes: {
				2: { 1: [candidate(hash('d'), 'The.Wire.S02E01.1080p', 1)] },
				3: {},
			},
		});
		const { result } = render();

		await act(async () => {
			await result.current.discover('rd', null);
		});

		const episodeCall = mockAxiosGet.mock.calls.find(
			(call) => call[1].params.mode === 'episodes'
		);
		expect(episodeCall![1].params.seasons).toBe('2,3');
	});

	it('asks for episodes for none of them when every season has a pack', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		const { result } = render();
		await act(async () => {
			await result.current.discover('rd', null);
		});
		expect(mockAxiosGet.mock.calls.some((call) => call[1].params.mode === 'episodes')).toBe(
			false
		);
	});

	it('adds one pack per season, in season order', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});
		let outcome: any;
		await act(async () => {
			outcome = await result.current.run(plan!, false);
		});

		expect(addRd.mock.calls.map((c) => c[0])).toEqual([hash('a'), hash('b'), hash('c')]);
		// Silent, and carrying the row: the page never rendered these seasons.
		expect(addRd.mock.calls[0][3].silent).toBe(true);
		expect(addRd.mock.calls[0][3].row.title).toBe('The.Wire.S01.1080p');
		expect(outcome.added).toBe(3);
	});

	it('tries the next pack when the first is not really instant', async () => {
		respondWith({
			packs: {
				1: [
					candidate(hash('a'), 'The.Wire.S01.1080p', 10),
					candidate(hash('b'), 'The.Wire.S01.720p', 10),
				],
				2: [],
				3: [],
			},
			episodes: { 2: {}, 3: {} },
		});
		addRd.mockImplementation(async (h: string) => h !== hash('a'));
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});
		await act(async () => {
			await result.current.run(plan!, false);
		});

		expect(addRd.mock.calls.map((c) => c[0])).toEqual([hash('a'), hash('b')]);
	});

	it('fills only the episodes the library is missing', async () => {
		respondWith({
			packs: { 1: [], 2: [], 3: [] },
			episodes: {
				1: {
					1: [candidate(hash('a'), 'The.Wire.S01E01.1080p', 1)],
					2: [candidate(hash('b'), 'The.Wire.S01E02.1080p', 1)],
					3: [candidate(hash('c'), 'The.Wire.S01E03.1080p', 1)],
				},
				2: {},
				3: {},
			},
		});
		// Episode one is already held, so only two and three are wanted.
		const { result } = render([libraryRow('The.Wire.S01E01.1080p.BluRay.x264-GROUP')]);

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});
		await act(async () => {
			await result.current.run(plan!, false);
		});

		expect(addRd.mock.calls.map((c) => c[0])).toEqual([hash('b'), hash('c')]);
	});

	it('lets one release satisfy every episode it spans', async () => {
		respondWith({
			packs: { 1: [], 2: [], 3: [] },
			episodes: {
				1: {
					1: [candidate(hash('a'), 'The.Wire.S01E01-E03.1080p', 3, [1, 2, 3])],
					2: [candidate(hash('a'), 'The.Wire.S01E01-E03.1080p', 3, [1, 2, 3])],
					3: [candidate(hash('a'), 'The.Wire.S01E01-E03.1080p', 3, [1, 2, 3])],
				},
				2: {},
				3: {},
			},
		});
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});
		await act(async () => {
			await result.current.run(plan!, false);
		});

		// One add, not three: the release covers episodes one through three.
		expect(addRd).toHaveBeenCalledTimes(1);
	});

	it('gives up once Real-Debrid is throttling rather than grinding', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		addRd.mockResolvedValue(false);
		mockHasRecentRdRateLimits.mockReturnValue(true);
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});
		let outcome: any;
		await act(async () => {
			outcome = await result.current.run(plan!, false);
		});

		// Each attempt has already spent up to two twenty-second backoffs inside
		// the add itself, so a run that kept going would cost minutes.
		expect(outcome.abortedByThrottle).toBe(true);
		expect(addRd.mock.calls.length).toBeLessThanOrEqual(2);
	});

	it('keeps going when an add simply fails without a throttle', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		addRd.mockImplementation(async (h: string) => h !== hash('a'));
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});
		let outcome: any;
		await act(async () => {
			outcome = await result.current.run(plan!, false);
		});

		expect(outcome.added).toBe(2);
		expect(outcome.gaps).toEqual([1]);
	});

	it('adds only what TorBox actually holds', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p')],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p')],
				3: [],
			},
			episodes: { 3: {} },
		});
		// Only season one's pack is cached on TorBox, and its file list is what
		// the pack window counts - Real-Debrid's table is never consulted.
		mockCheckCachedStatus.mockResolvedValue({
			success: true,
			data: {
				[hash('a')]: {
					files: Array.from({ length: 10 }, (_, i) => ({
						id: i,
						name: `The.Wire.S01E${i + 1}.mkv`,
						size: 1,
					})),
				},
			},
		});
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('tb', 'tb-key');
		});
		await act(async () => {
			await result.current.run(plan!, true);
		});

		expect(addTb.mock.calls.map((c) => c[0])).toEqual([hash('a')]);
		expect(addTb.mock.calls[0][1].silent).toBe(true);
	});

	it('stops when asked', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		addRd.mockImplementation(async () => {
			result.current.stop();
			return true;
		});
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});
		await act(async () => {
			await result.current.run(plan!, false);
		});

		expect(addRd).toHaveBeenCalledTimes(1);
	});

	it('abandons the run when the page moves to another show', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		const { result, rerender } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});

		// Hold the first add open so the navigation lands mid-run rather than
		// after the loop has already raced to the end.
		let announceFirstAdd: () => void = () => {};
		const firstAddStarted = new Promise<void>((resolve) => {
			announceFirstAdd = resolve;
		});
		let releaseFirstAdd: () => void = () => {};
		const firstAddGate = new Promise<void>((resolve) => {
			releaseFirstAdd = resolve;
		});
		addRd.mockImplementation(async () => {
			announceFirstAdd();
			await firstAddGate;
			return true;
		});

		const running = result.current.run(plan!, false);
		await firstAddStarted;

		// Navigating re-renders with a new id, which tears down the effect keyed
		// on it. The loop holds its own closure and cannot notice the page moved
		// on by itself, so without that cleanup it would keep filling the
		// previous show's library in the background.
		await act(async () => {
			rerender({ imdbId: 'tt0141842' });
		});

		releaseFirstAdd();
		let outcome: any;
		await act(async () => {
			outcome = await running;
		});

		expect(addRd).toHaveBeenCalledTimes(1);
		expect(outcome.stopped).toBe(true);
	});

	it('never offers a release whose name Real-Debrid blocks', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p.WEB-DL.DDP5.1.H.264', 10)],
				2: [],
				3: [],
			},
			episodes: { 1: {}, 2: {}, 3: {} },
		});
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd', null);
		});
		await act(async () => {
			await result.current.run(plan!, false);
		});

		// `web-dl` is one of the measured `451 infringing_file` patterns. A
		// blocked name is refused on the first request every time, so spending
		// an attempt on it only earns a 451 and two twenty-second backoffs.
		expect(addRd).not.toHaveBeenCalled();
	});
});
