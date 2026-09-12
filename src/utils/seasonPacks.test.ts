import { UserTorrentStatus, type UserTorrent } from '@/torrent/userTorrent';
import { filenameParse } from '@ctrl/video-filename-parser';
import { describe, expect, it } from 'vitest';
import {
	airedEpisodeCount,
	getSeasonCoverage,
	isCompleteSeasonPack,
	missingEpisodesFor,
	planSeason,
	summarisePlan,
	type SeasonCandidate,
} from './seasonPacks';

/**
 * Library rows the way `convertToUserTorrent` builds them: `info` is whatever
 * `filenameParse(name, true)` makes of the torrent's own name, never a
 * hand-written shape. A fixture written by hand would only confirm the reading
 * of the parser that was assumed while writing this, which is the one thing
 * worth checking.
 */
const libraryRow = (
	name: string,
	{ service = 'rd', hash = name.toLowerCase() }: { service?: 'rd' | 'tb'; hash?: string } = {}
): UserTorrent => ({
	id: `${service}:${name}`,
	filename: name,
	title: name,
	hash,
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

const candidate = (hash: string, videoCount?: number): SeasonCandidate => ({
	hash,
	title: hash,
	sizeMb: 5000,
	videoCount,
});

const noCoverage = { hasPack: false, episodes: [] };

describe('isCompleteSeasonPack', () => {
	it('accepts the season page window of plus or minus two', () => {
		expect(isCompleteSeasonPack(10, 10)).toBe(true);
		expect(isCompleteSeasonPack(8, 10)).toBe(true);
		expect(isCompleteSeasonPack(12, 10)).toBe(true);
		expect(isCompleteSeasonPack(7, 10)).toBe(false);
		expect(isCompleteSeasonPack(13, 10)).toBe(false);
	});

	it('never lets the floor fall below one video', () => {
		// A two-episode season would otherwise accept a zero-video release.
		expect(isCompleteSeasonPack(0, 2)).toBe(false);
		expect(isCompleteSeasonPack(1, 2)).toBe(true);
	});
});

describe('getSeasonCoverage', () => {
	const opts = { season: 3, showTitle: 'The Wire', servicePrefix: 'rd' as const };

	it('reads a season pack in the library as the season', () => {
		const coverage = getSeasonCoverage(
			[libraryRow('The.Wire.S03.1080p.BluRay.x264-GROUP')],
			opts
		);
		expect(coverage).toEqual({ hasPack: true, episodes: [] });
	});

	it('reads a multi-season pack as covering each of its seasons', () => {
		// The case infohash identity cannot see: nothing is filed under
		// `tv:<imdb>:3` for this release, so the season looks empty and the run
		// would add a fourth copy of a show the user already holds complete.
		const library = [libraryRow('The Wire S01-S05 COMPLETE 1080p BluRay x264')];
		expect(getSeasonCoverage(library, opts).hasPack).toBe(true);
		expect(getSeasonCoverage(library, { ...opts, season: 1 }).hasPack).toBe(true);
		expect(getSeasonCoverage(library, { ...opts, season: 5 }).hasPack).toBe(true);
		expect(getSeasonCoverage(library, { ...opts, season: 6 }).hasPack).toBe(false);
	});

	it('collects loose episodes without calling the season held', () => {
		const coverage = getSeasonCoverage(
			[
				libraryRow('The.Wire.S03E02.1080p.BluRay.x264-GROUP'),
				libraryRow('The.Wire.S03E01.1080p.BluRay.x264-GROUP'),
			],
			opts
		);
		expect(coverage).toEqual({ hasPack: false, episodes: [1, 2] });
	});

	it('does not let an extras or subpack release stand in for the season', () => {
		// Both parse `fullSeason: true`; only `isSeasonExtra` separates them from
		// a real pack, and treating them as one skips the season permanently.
		expect(getSeasonCoverage([libraryRow('The.Wire.S03.EXTRAS.1080p')], opts).hasPack).toBe(
			false
		);
		expect(getSeasonCoverage([libraryRow('The.Wire.S03.SUBPACK')], opts).hasPack).toBe(false);
	});

	it('does not let a half-season pack stand in for the season', () => {
		expect(getSeasonCoverage([libraryRow('The.Wire.S03.Part.1.1080p')], opts).hasPack).toBe(
			false
		);
	});

	it('ignores another show that happens to have the same season', () => {
		expect(
			getSeasonCoverage([libraryRow('Breaking.Bad.S03.1080p.BluRay.x264')], opts).hasPack
		).toBe(false);
	});

	it('keeps the services apart', () => {
		const library = [libraryRow('The.Wire.S03.1080p.BluRay.x264-GROUP', { service: 'tb' })];
		expect(getSeasonCoverage(library, opts).hasPack).toBe(false);
		expect(getSeasonCoverage(library, { ...opts, servicePrefix: 'tb' }).hasPack).toBe(true);
	});

	it('trusts the season key for a release whose name parses no season', () => {
		// Scene names that lost their season marker still sit under the season's
		// scraped key, and that key is anchored to the imdb id.
		const library = [libraryRow('the.wire.complete.pack-group', { hash: 'abc123' })];
		expect(getSeasonCoverage(library, opts).hasPack).toBe(false);
		expect(
			getSeasonCoverage(library, { ...opts, knownHashes: new Set(['abc123']) }).hasPack
		).toBe(true);
	});
});

describe('airedEpisodeCount', () => {
	it('caps the airing season at the last episode that aired', () => {
		// Cinemeta counts the ordered season, so a returning show reports ten
		// episodes in September and has aired three. Judged against ten, no pack
		// ever satisfies the window and the season is a gap on every run.
		expect(airedEpisodeCount(3, 10, { season_number: 3, episode_number: 3 })).toBe(3);
	});

	it('leaves finished seasons alone', () => {
		expect(airedEpisodeCount(2, 10, { season_number: 3, episode_number: 3 })).toBe(10);
		expect(airedEpisodeCount(3, 10, null)).toBe(10);
	});
});

describe('missingEpisodesFor', () => {
	it('asks only for the gaps', () => {
		expect(missingEpisodesFor({ hasPack: false, episodes: [1, 2] }, 5)).toEqual([3, 4, 5]);
	});

	it('asks for nothing when a pack is held', () => {
		expect(missingEpisodesFor({ hasPack: true, episodes: [] }, 5)).toEqual([]);
	});

	it('asks for nothing when the season has aired nothing', () => {
		expect(missingEpisodesFor(noCoverage, 0)).toEqual([]);
	});
});

describe('planSeason', () => {
	const base = {
		season: 3,
		expectedEpisodeCount: 10,
		packCandidates: [],
		episodeCandidates: new Map<number, SeasonCandidate[]>(),
	};

	it('skips a season already held as a pack', () => {
		const entry = planSeason({ ...base, coverage: { hasPack: true, episodes: [] } });
		expect(entry.status).toBe('held');
		expect(entry.addCount).toBe(0);
	});

	it('skips a season held complete as individual episodes', () => {
		const coverage = { hasPack: false, episodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
		expect(planSeason({ ...base, coverage }).status).toBe('held');
	});

	it('prefers a cached pack even when some episodes are already held', () => {
		// Two of ten held and a pack available: one add beats eight, and the
		// window already treats a pack one episode short as the season.
		const entry = planSeason({
			...base,
			coverage: { hasPack: false, episodes: [1, 2] },
			packCandidates: [candidate('pack', 10)],
			episodeCandidates: new Map([[3, [candidate('ep3', 1)]]]),
		});
		expect(entry.status).toBe('pack');
		expect(entry.addCount).toBe(1);
		expect(entry.missingEpisodes).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
	});

	it('falls back to the missing episodes only when no pack is cached', () => {
		const entry = planSeason({
			...base,
			coverage: { hasPack: false, episodes: [1, 2] },
			episodeCandidates: new Map([
				[1, [candidate('ep1', 1)]],
				[3, [candidate('ep3', 1)]],
				[4, [candidate('ep4', 1)]],
			]),
		});
		expect(entry.status).toBe('episodes');
		// Episode one is cached and already held, so it is not re-added.
		expect([...entry.episodeCandidates.keys()]).toEqual([3, 4]);
		expect(entry.addCount).toBe(2);
	});

	it('does not count a release outside the window as a pack', () => {
		const entry = planSeason({
			...base,
			coverage: noCoverage,
			packCandidates: [candidate('half', 5)],
		});
		expect(entry.status).toBe('gap');
	});

	it('does not count a candidate whose file list is unknown as a pack', () => {
		// `videoCount` only exists once an availability check has run; without
		// one there is no evidence the release is the season.
		const entry = planSeason({
			...base,
			coverage: noCoverage,
			packCandidates: [candidate('unchecked')],
		});
		expect(entry.status).toBe('gap');
	});

	it('reports a gap when nothing cached covers the season', () => {
		const entry = planSeason({ ...base, coverage: noCoverage });
		expect(entry.status).toBe('gap');
		expect(entry.addCount).toBe(0);
	});
});

describe('summarisePlan', () => {
	it('totals the adds the confirmation has to state', () => {
		const entries = [
			planSeason({
				season: 1,
				expectedEpisodeCount: 10,
				coverage: { hasPack: true, episodes: [] },
				packCandidates: [],
				episodeCandidates: new Map(),
			}),
			planSeason({
				season: 2,
				expectedEpisodeCount: 10,
				coverage: noCoverage,
				packCandidates: [candidate('pack', 10)],
				episodeCandidates: new Map(),
			}),
			planSeason({
				season: 3,
				expectedEpisodeCount: 3,
				coverage: noCoverage,
				packCandidates: [],
				episodeCandidates: new Map([
					[1, [candidate('a', 1)]],
					[2, [candidate('b', 1)]],
					[3, [candidate('c', 1)]],
				]),
			}),
		];

		const summary = summarisePlan(entries);
		expect(summary.held).toHaveLength(1);
		expect(summary.packs).toHaveLength(1);
		expect(summary.episodeAddCount).toBe(3);
		expect(summary.totalAddCount).toBe(4);
	});
});
