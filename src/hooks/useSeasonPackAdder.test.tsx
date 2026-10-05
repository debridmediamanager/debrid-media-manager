import { ms, recordedAnswer, sequence } from '@/test/realdebrid/rdAddPauseReplay';
import { UserTorrentStatus, type UserTorrent } from '@/torrent/userTorrent';
import { RD_ADD_PAUSE_GIVE_UP_MS, RD_ADD_PAUSE_MS } from '@/utils/rdAddPause';
import { filenameParse } from '@ctrl/video-filename-parser';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSeasonPackAdder, type SeasonAdderPlan } from './useSeasonPackAdder';

const {
	mockAxiosGet,
	mockCheckCachedStatus,
	mockCheckPremiumizeCache,
	mockCheckOffcloudCache,
	mockIsRdThrottling,
} = vi.hoisted(() => ({
	mockAxiosGet: vi.fn(),
	mockCheckCachedStatus: vi.fn(),
	mockCheckPremiumizeCache: vi.fn(),
	mockCheckOffcloudCache: vi.fn(),
	mockIsRdThrottling: vi.fn(() => false),
}));

vi.mock('axios', () => ({ default: { get: mockAxiosGet } }));
vi.mock('@/services/torbox', () => ({ checkCachedStatus: mockCheckCachedStatus }));
vi.mock('@/services/premiumize', () => ({ checkPremiumizeCache: mockCheckPremiumizeCache }));
vi.mock('@/services/offcloud', () => ({ checkOffcloudCache: mockCheckOffcloudCache }));
vi.mock('@/services/realDebrid', () => ({
	isRdThrottling: mockIsRdThrottling,
	RD_ADD_MIN_SPACING_MS: 2000,
}));
vi.mock('@/utils/token', () => ({
	generateTokenAndHash: vi.fn(async () => ['token-ts', 'token-hash']),
}));

const hash = (marker: string) => marker.repeat(40).slice(0, 40);

const candidate = (
	hash: string,
	title: string,
	videoCount?: number,
	episodes?: number[],
	seasons?: number[]
) => ({
	hash,
	title,
	sizeMb: 5000,
	rdAvailable: true,
	videoCount,
	files: [{ fileId: 1, filename: `${title}.mkv`, filesize: 1 }],
	...(episodes ? { episodes } : {}),
	...(seasons ? { seasons } : {}),
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

let addCached: ReturnType<typeof vi.fn>;

const render = (libraryItems: UserTorrent[] = []) =>
	renderHook(
		({ imdbId }: { imdbId: string }) =>
			useSeasonPackAdder({
				imdbId,
				show,
				libraryItems,
				hashAndProgress: {},
				addCached: addCached as never,
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
		mockIsRdThrottling.mockReturnValue(false);
		addCached = vi.fn(async () => true);
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
			plan = await result.current.discover('rd');
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
			plan = await result.current.discover('rd');
		});

		expect(plan!.entries.map((e) => e.status)).toEqual(['pack', 'held', 'pack']);
		expect(plan!.summary.totalAddCount).toBe(2);
	});

	it('offers a pack to a season the library holds complete as loose episodes', async () => {
		// The library that prompted this: an old *arr filled season two one
		// episode at a time, from whatever it could find, so the season is
		// complete and mismatched at once. It used to report as held and never
		// see the pack that would make it consistent.
		const looseSeasonTwo = [
			'The.Wire.S02E01.1080p.WEBRip.H264-TARS',
			'The Wire S02E02 720p WEBRip H264-TARS',
			'The Wire S02E03 1080p',
			'The Wire S02E04 1080p.ts',
			'The.Wire.S02E05.1080p.WEBRip.H264-TARS[brassetv]',
			'The.Wire.S02E06.720p.HDTV.x264-BATV[rarbg]',
			'The.Wire.S02E07.1080p.WEBRip.H264-TARS',
			'The Wire S02E08 720p WEBRip H264-TARS',
			'The Wire S02E09 1080p.ts',
			'The Wire S02E10 1080p [Timati]',
		].map((name) => libraryRow(name));

		respondWith({
			packs: {
				1: [],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [],
			},
		});
		const { result } = render(looseSeasonTwo);

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd');
		});

		expect(plan!.entries[1].status).toBe('pack');
		expect(plan!.entries[1].coverage).toEqual({
			hasPack: false,
			episodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
		});
		// Nothing is missing, so the pack is an upgrade the confirmation names
		// apart from the seasons that were actually short.
		expect(plan!.entries[1].missingEpisodes).toEqual([]);
		expect(plan!.summary.upgrades).toHaveLength(1);

		await act(async () => {
			await result.current.run(plan!);
		});

		// One add, and the ten episodes it duplicates are left exactly as they
		// were - the run has no way to remove anything at all.
		expect(addCached).toHaveBeenCalledTimes(1);
		expect(addCached.mock.calls[0][1]).toBe(hash('b'));
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
			await result.current.discover('rd');
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
			await result.current.discover('rd');
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
			plan = await result.current.discover('rd');
		});
		let outcome: any;
		await act(async () => {
			outcome = await result.current.run(plan!);
		});

		expect(addCached.mock.calls.map((c) => c[1])).toEqual([hash('a'), hash('b'), hash('c')]);
		// Silent, and carrying the row: the page never rendered these seasons.
		expect(addCached.mock.calls[0][2].silent).toBe(true);
		expect(addCached.mock.calls[0][2].row.title).toBe('The.Wire.S01.1080p');
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
		addCached.mockImplementation(async (_service: string, h: string) => h !== hash('a'));
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd');
		});
		await act(async () => {
			await result.current.run(plan!);
		});

		expect(addCached.mock.calls.map((c) => c[1])).toEqual([hash('a'), hash('b')]);
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
			plan = await result.current.discover('rd');
		});
		await act(async () => {
			await result.current.run(plan!);
		});

		expect(addCached.mock.calls.map((c) => c[1])).toEqual([hash('b'), hash('c')]);
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
			plan = await result.current.discover('rd');
		});
		await act(async () => {
			await result.current.run(plan!);
		});

		// One add, not three: the release covers episodes one through three.
		expect(addCached).toHaveBeenCalledTimes(1);
	});

	// The run stops on time, not on a count: RD's pauses last 21 s to about
	// five minutes, so only refusing everything for longer than that ends it.
	it('gives up once Real-Debrid has refused every add for longer than any pause', async () => {
		const packs = (season: number, markers: string[]) =>
			markers.map((m, i) => candidate(hash(m), `The.Wire.S0${season}.v${i}.1080p`, 10));
		respondWith({
			packs: {
				1: packs(1, ['a', 'b', 'c', 'd']),
				2: packs(2, ['e', 'f', 'g', 'h']),
				3: packs(3, ['i', 'j', 'k', 'l']),
			},
		});
		vi.useFakeTimers();
		try {
			// Every add refused, each one after a 30 s hold, for ever.
			addCached.mockImplementation(async (_s: string, _h: string, opts: any) => {
				await new Promise((resolve) => setTimeout(resolve, RD_ADD_PAUSE_MS));
				opts?.onPaused?.();
				return false;
			});
			const { result } = render();

			let plan: SeasonAdderPlan | null = null;
			await act(async () => {
				plan = await result.current.discover('rd');
			});
			let outcome: any;
			await act(async () => {
				const running = result.current.run(plan!);
				await vi.advanceTimersByTimeAsync(RD_ADD_PAUSE_GIVE_UP_MS + 4 * RD_ADD_PAUSE_MS);
				outcome = await running;
			});

			expect(outcome.abortedByThrottle).toBe(true);
			// Two tries per release, a minute a release, and the run ends once
			// the refusals have outlasted RD_ADD_PAUSE_GIVE_UP_MS: well past
			// two 451s, well short of all twelve releases.
			const tried = addCached.mock.calls.map((c) => c[1]);
			const releases = tried.filter((_, i) => i % 2 === 0);
			expect(tried).toEqual(releases.flatMap((h) => [h, h]));
			expect(releases.length).toBe(RD_ADD_PAUSE_GIVE_UP_MS / (2 * RD_ADD_PAUSE_MS) + 1);
		} finally {
			vi.useRealTimers();
		}
	});

	// Replays the 183 s pause the test account went into at 23:33:02
	// (src/test/fixtures/realdebrid/rd-add-account-pause-2026-10-05.json): a run
	// that meets it must sit it out and keep adding, not stop after two 451s or
	// report seasons RD holds as missing.
	it('waits out a recorded Real-Debrid pause and keeps adding (f1, 23:33)', async () => {
		const probes = sequence('f1').filter((a) => a.role === 'probe');
		const control = sequence('f1').find((a) => a.role === 'control' && a.status === 451)!;
		respondWith({
			packs: {
				1: [
					candidate(control.hash, 'The.Wire.S01.1080p', 10),
					candidate(probes[0].hash, 'The.Wire.S01.720p', 10),
				],
				2: [candidate(probes[1].hash, 'The.Wire.S02.1080p', 10)],
				3: [candidate(probes[2].hash, 'The.Wire.S03.1080p', 10)],
			},
		});
		vi.useFakeTimers();
		vi.setSystemTime(ms(control.at));
		try {
			// The account as recorded, behind the hold `addHashAsMagnet` keeps:
			// after a 451, the next add waits RD_ADD_PAUSE_MS.
			let heldUntil = 0;
			const answered: { hash: string; status: number }[] = [];
			mockIsRdThrottling.mockImplementation(
				() => recordedAnswer(probes[0].hash, Date.now()) === 451
			);
			addCached.mockImplementation(async (_s: string, h: string, opts: any) => {
				const wait = heldUntil - Date.now();
				if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
				const status = recordedAnswer(h, Date.now());
				answered.push({ hash: h, status });
				if (status === 451) {
					heldUntil = Date.now() + RD_ADD_PAUSE_MS;
					opts?.onPaused?.();
					return false;
				}
				return true;
			});
			const { result } = render();

			let plan: SeasonAdderPlan | null = null;
			await act(async () => {
				plan = await result.current.discover('rd');
			});
			let outcome: any;
			await act(async () => {
				const running = result.current.run(plan!);
				await vi.advanceTimersByTimeAsync(10 * RD_ADD_PAUSE_MS);
				outcome = await running;
			});

			expect(outcome.abortedByThrottle).toBe(false);
			// The pause ended at 23:36:10; everything tried after it landed.
			expect(answered.filter((a) => a.status === 201).length).toBeGreaterThan(0);
			expect(outcome.added + outcome.refused.length).toBe(3);
			expect(outcome.gaps).toEqual([]);
			// A refused pack got its second try before the run moved on.
			expect(answered[0].hash).toBe(control.hash);
			expect(answered[1].hash).toBe(control.hash);
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps going when an add simply fails without a throttle', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		addCached.mockImplementation(async (_service: string, h: string) => h !== hash('a'));
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd');
		});
		let outcome: any;
		await act(async () => {
			outcome = await result.current.run(plan!);
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
			plan = await result.current.discover('tb', { tb: 'tb-key' });
		});
		await act(async () => {
			await result.current.run(plan!);
		});

		expect(addCached.mock.calls.map((c) => [c[0], c[1]])).toEqual([['tb', hash('a')]]);
		expect(addCached.mock.calls[0][2].silent).toBe(true);
	});

	it('stops when asked', async () => {
		respondWith({
			packs: {
				1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [candidate(hash('c'), 'The.Wire.S03.1080p', 10)],
			},
		});
		addCached.mockImplementation(async () => {
			result.current.stop();
			return true;
		});
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd');
		});
		await act(async () => {
			await result.current.run(plan!);
		});

		expect(addCached).toHaveBeenCalledTimes(1);
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
			plan = await result.current.discover('rd');
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
		addCached.mockImplementation(async () => {
			announceFirstAdd();
			await firstAddGate;
			return true;
		});

		const running = result.current.run(plan!);
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

		expect(addCached).toHaveBeenCalledTimes(1);
		expect(outcome.stopped).toBe(true);
	});

	it('adds a complete-series release once and counts every season it covers', async () => {
		// tt0306414 on the live index: seasons one and five had no cached
		// single-season pack, only 60-video `S01-S05` releases. Adding one per
		// season would put the same 470 GB torrent in the account five times.
		// Three ten-episode seasons, so a release covering all three carries 30.
		const series = candidate(
			'e'.repeat(40),
			'The.Wire.Complete.S01-S03.1080p',
			30,
			undefined,
			[1, 2, 3]
		);
		respondWith({ packs: { 1: [series], 2: [series], 3: [series] } });
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('rd');
		});

		expect(plan!.entries.map((e) => e.status)).toEqual(['pack', 'pack', 'pack']);
		// Three seasons, one torrent.
		expect(plan!.summary.totalAddCount).toBe(1);

		let outcome: any;
		await act(async () => {
			outcome = await result.current.run(plan!);
		});

		expect(addCached).toHaveBeenCalledTimes(1);
		expect(outcome.added).toBe(3);
		expect(outcome.gaps).toEqual([]);
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
			plan = await result.current.discover('rd');
		});
		await act(async () => {
			await result.current.run(plan!);
		});

		// `web-dl` is one of the measured `451 infringing_file` patterns. A
		// blocked name is refused on the first request every time, so spending
		// an attempt on it only earns a 451 and two twenty-second backoffs.
		expect(addCached).not.toHaveBeenCalled();
	});

	it('adds only what AllDebrid holds, from its own availability table', async () => {
		respondWith({
			packs: {
				1: [{ ...candidate(hash('a'), 'The.Wire.S01.1080p', 10), adAvailable: true }],
				// RD holds season two, AllDebrid does not.
				2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
				3: [],
			},
			episodes: { 2: {}, 3: {} },
		});
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('ad');
		});
		expect(plan!.entries.map((e) => e.status)).toEqual(['pack', 'gap', 'gap']);

		await act(async () => {
			await result.current.run(plan!);
		});
		expect(addCached.mock.calls.map((c) => [c[0], c[1]])).toEqual([['ad', hash('a')]]);
		expect(addCached.mock.calls[0][2].row.adAvailable).toBe(true);
	});

	it.each([
		['pm', () => mockCheckPremiumizeCache],
		['oc', () => mockCheckOffcloudCache],
	] as const)(
		'adds only what the %s probe reports, counting packs from the stored file list',
		async (service, probe) => {
			respondWith({
				packs: {
					1: [candidate(hash('a'), 'The.Wire.S01.1080p', 10)],
					2: [candidate(hash('b'), 'The.Wire.S02.1080p', 10)],
					3: [],
				},
				episodes: { 3: {} },
			});
			probe().mockResolvedValue([
				{ hash: hash('a'), cached: true },
				{ hash: hash('b'), cached: false },
			]);
			const { result } = render();

			let plan: SeasonAdderPlan | null = null;
			await act(async () => {
				plan = await result.current.discover(service, { [service]: 'the-key' });
			});
			expect(probe()).toHaveBeenCalledWith('the-key', expect.arrayContaining([hash('a')]));

			await act(async () => {
				await result.current.run(plan!);
			});
			expect(addCached.mock.calls.map((c) => [c[0], c[1]])).toEqual([[service, hash('a')]]);
		}
	);

	it('offers a release to TorBox that only Real-Debrid blocks by name', async () => {
		const name = 'The.Wire.S01.1080p.WEB-DL.DDP5.1.H.264';
		respondWith({ packs: { 1: [candidate(hash('a'), name)], 2: [], 3: [] }, episodes: {} });
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
			plan = await result.current.discover('tb', { tb: 'tb-key' });
		});
		await act(async () => {
			await result.current.run(plan!);
		});

		// `web-dl` is RD's 451 filter. TorBox serves the name, so dropping it
		// here left the season as a gap for no reason.
		expect(addCached.mock.calls.map((c) => [c[0], c[1]])).toEqual([['tb', hash('a')]]);
	});

	it("does not read Real-Debrid's throttle into another service's misses", async () => {
		respondWith({
			packs: {
				1: [{ ...candidate(hash('a'), 'The.Wire.S01.1080p', 10), adAvailable: true }],
				2: [{ ...candidate(hash('b'), 'The.Wire.S02.1080p', 10), adAvailable: true }],
				3: [{ ...candidate(hash('c'), 'The.Wire.S03.1080p', 10), adAvailable: true }],
			},
		});
		// RD happens to be in a penalty from something else on the page.
		mockIsRdThrottling.mockReturnValue(true);
		addCached.mockImplementation(async (_service: string, h: string) => h !== hash('a'));
		const { result } = render();

		let plan: SeasonAdderPlan | null = null;
		await act(async () => {
			plan = await result.current.discover('ad');
		});
		let outcome: any;
		await act(async () => {
			outcome = await result.current.run(plan!);
		});

		expect(outcome.abortedByThrottle).toBe(false);
		expect(outcome.added).toBe(2);
	});
});
