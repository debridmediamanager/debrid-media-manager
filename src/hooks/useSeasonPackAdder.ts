import type { FileData, SearchResult } from '@/services/mediasearch';
import { hasRecentRdRateLimits } from '@/services/realDebrid';
import { checkCachedStatus } from '@/services/torbox';
import type { UserTorrent } from '@/torrent/userTorrent';
import { runConcurrentFunctions } from '@/utils/batch';
import { isRdBlockedName } from '@/utils/deInfringe';
import { delay } from '@/utils/delay';
import { groupBy } from '@/utils/groupBy';
import {
	airedEpisodeCount,
	getSeasonCoverage,
	planSeason,
	summarisePlan,
	type SeasonPlanEntry,
} from '@/utils/seasonPacks';
import { isVideo } from '@/utils/selectable';
import { generateTokenAndHash } from '@/utils/token';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AddRdOptions, AddTbOptions } from './useTorrentManagement';

export type SeasonAdderService = 'rd' | 'tb';

/** What happened to one season during a run, for the season navigation to show. */
export type SeasonRunState = 'pending' | 'running' | 'added' | 'held' | 'gap' | 'failed';

/**
 * Adds every season of a show that is missing from the library.
 *
 * The season page can only see the season it is on, so this resolves the rest
 * from one server call rather than walking the season search once per season -
 * that route is rate limited at one request every two seconds per IP, which for
 * a twenty-season show is forty seconds of waiting before the first add.
 *
 * The order of preference per season is the one a user asked for: a cached pack
 * covers the season in one add even when a few episodes are already held, and
 * only a season with no cached pack falls back to filling its gaps episode by
 * episode. What is already held is decided from the library rather than by
 * infohash - see `getSeasonCoverage`.
 */

/** Between adds. RD answers a burst of adds with 451, its throttle wearing a content-block status. */
const ADD_SPACING_MS = process.env.VITEST_WORKER_ID ? 0 : 1200;
/**
 * Two throttled adds in a row ends the run. Each one has already spent up to
 * two twenty-second backoffs inside `handleAddAsMagnetInRd`, so grinding on
 * costs minutes and returns answers that are wrong anyway.
 */
const THROTTLE_ABORT_AFTER = 2;
/** TorBox swallows a hundred hashes per cache probe; two in flight is its measured comfort. */
const TB_PROBE_BATCH = 100;

type ApiCandidate = {
	hash: string;
	title: string;
	sizeMb: number;
	rdAvailable: boolean;
	videoCount?: number;
	files?: FileData[];
	seasons?: number[];
	episodes?: number[];
};

type ApiSeason = {
	season: number;
	packs: ApiCandidate[];
	episodes: Record<string, ApiCandidate[]>;
};

export type SeasonAdderPlan = {
	service: SeasonAdderService;
	entries: SeasonPlanEntry[];
	summary: ReturnType<typeof summarisePlan>;
};

type ShowFacts = {
	title: string;
	seasonCount: number;
	episodeCounts: Record<number, number>;
	lastEpisodeToAir?: { season_number: number; episode_number: number } | null;
};

/** A candidate carries everything `addRd` needs to read a 451 correctly. */
const asSearchResult = (candidate: ApiCandidate, service: SeasonAdderService): SearchResult => ({
	title: candidate.title,
	fileSize: candidate.sizeMb,
	hash: candidate.hash,
	rdAvailable: service === 'rd',
	adAvailable: false,
	tbAvailable: service === 'tb',
	pmAvailable: false,
	ocAvailable: false,
	files: candidate.files ?? [],
	rdFiles: service === 'rd' ? candidate.files : undefined,
	tbFiles: service === 'tb' ? candidate.files : undefined,
	noVideos: false,
	medianFileSize: 0,
	biggestFileSize: 0,
	videoCount: candidate.videoCount ?? 0,
});

const filenamesOf = (candidate: ApiCandidate) => (candidate.files ?? []).map((f) => f.filename);

export function useSeasonPackAdder({
	imdbId,
	show,
	libraryItems,
	hashAndProgress,
	addRd,
	addTb,
	episodeMaxSize,
}: {
	imdbId: string;
	show: ShowFacts | null;
	libraryItems: UserTorrent[];
	hashAndProgress: Record<string, number>;
	addRd: (
		hash: string,
		isCheckingAvailability?: boolean,
		deleteIfNotInstant?: boolean,
		opts?: AddRdOptions
	) => Promise<any>;
	addTb: (hash: string, opts?: AddTbOptions) => Promise<any>;
	episodeMaxSize: string;
}) {
	const [discovering, setDiscovering] = useState(false);
	const [running, setRunning] = useState(false);
	const [seasonState, setSeasonState] = useState<Record<number, SeasonRunState>>({});
	const stopped = useRef(false);

	/**
	 * Leaving the show ends the run.
	 *
	 * Without this, navigating away keeps filling the previous show's library in
	 * the background - the loop holds its own closure, so it cannot notice on its
	 * own that the page has moved on. The cleanup covers unmounting too, which is
	 * the other way a user leaves.
	 */
	useEffect(() => {
		return () => {
			stopped.current = true;
		};
	}, [imdbId]);

	const stop = useCallback(() => {
		stopped.current = true;
	}, []);

	/**
	 * TorBox availability, which the server cannot answer: the cache probe needs
	 * the user's own key. It also supplies the file list the pack window counts,
	 * so a TorBox run never reads Real-Debrid's availability table.
	 */
	const sweepTorBox = useCallback(async (hashes: string[], tbKey: string) => {
		const found = new Map<string, { videoCount: number; files: FileData[] }>();
		if (hashes.length === 0) return found;

		const funcs = groupBy(TB_PROBE_BATCH, hashes).map((group) => async () => {
			const resp = await checkCachedStatus(
				{ hash: group, format: 'object', list_files: true },
				tbKey
			);
			if (!resp.success || !resp.data) return;
			for (const [hash, entry] of Object.entries(resp.data as Record<string, any>)) {
				const files: FileData[] = Array.isArray(entry?.files)
					? entry.files.map((file: any, index: number) => ({
							fileId: typeof file.id === 'number' ? file.id : index,
							filename: file.name ?? '',
							filesize: file.size ?? 0,
						}))
					: [];
				found.set(hash.toLowerCase(), {
					videoCount: files.filter((f) => isVideo({ path: f.filename })).length,
					files,
				});
			}
		});
		await runConcurrentFunctions(funcs, 2, 200);
		return found;
	}, []);

	const fetchSeasons = useCallback(
		async (seasons: number[], mode: 'packs' | 'episodes'): Promise<ApiSeason[]> => {
			if (seasons.length === 0) return [];
			const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
			const response = await axios.get<{ seasons: ApiSeason[] }>('/api/torrents/tv-seasons', {
				params: {
					imdbId,
					seasons: seasons.join(','),
					mode,
					maxSize: episodeMaxSize,
					dmmProblemKey: tokenWithTimestamp,
					solution: tokenHash,
				},
			});
			return response.data.seasons ?? [];
		},
		[imdbId, episodeMaxSize]
	);

	/**
	 * Narrows the server's candidates to what this service can actually serve
	 * instantly, and attaches the file counts the pack window needs. Real-Debrid
	 * arrives already answered by the availability table; TorBox is probed here.
	 */
	const resolveForService = useCallback(
		async (
			apiSeasons: ApiSeason[],
			service: SeasonAdderService,
			tbKey: string | null
		): Promise<ApiSeason[]> => {
			if (service === 'rd') {
				return apiSeasons.map((entry) => ({
					season: entry.season,
					packs: entry.packs.filter((c) => c.rdAvailable),
					episodes: Object.fromEntries(
						Object.entries(entry.episodes).map(([episode, bucket]) => [
							episode,
							bucket.filter((c) => c.rdAvailable),
						])
					),
				}));
			}

			if (!tbKey) return [];
			const hashes = new Set<string>();
			for (const entry of apiSeasons) {
				for (const pack of entry.packs) hashes.add(pack.hash);
				for (const bucket of Object.values(entry.episodes)) {
					for (const candidate of bucket) hashes.add(candidate.hash);
				}
			}
			const cached = await sweepTorBox([...hashes], tbKey);
			const applyTb = (candidate: ApiCandidate): ApiCandidate | null => {
				const hit = cached.get(candidate.hash.toLowerCase());
				if (!hit) return null;
				return { ...candidate, videoCount: hit.videoCount, files: hit.files };
			};
			return apiSeasons.map((entry) => ({
				season: entry.season,
				packs: entry.packs.map(applyTb).filter((c): c is ApiCandidate => c !== null),
				episodes: Object.fromEntries(
					Object.entries(entry.episodes).map(([episode, bucket]) => [
						episode,
						bucket.map(applyTb).filter((c): c is ApiCandidate => c !== null),
					])
				),
			}));
		},
		[sweepTorBox]
	);

	const buildEntries = useCallback(
		(apiSeasons: ApiSeason[], service: SeasonAdderService, facts: ShowFacts) =>
			apiSeasons.map((entry) => {
				const knownHashes = new Set<string>();
				for (const pack of entry.packs) knownHashes.add(pack.hash.toLowerCase());
				for (const bucket of Object.values(entry.episodes)) {
					for (const candidate of bucket) knownHashes.add(candidate.hash.toLowerCase());
				}

				const coverage = getSeasonCoverage(libraryItems, {
					season: entry.season,
					showTitle: facts.title,
					servicePrefix: service,
					knownHashes,
				});

				const episodeCandidates = new Map<number, ApiCandidate[]>();
				for (const [episode, bucket] of Object.entries(entry.episodes)) {
					const parsed = Number.parseInt(episode, 10);
					if (Number.isInteger(parsed) && bucket.length > 0) {
						episodeCandidates.set(parsed, bucket);
					}
				}

				return planSeason({
					season: entry.season,
					expectedEpisodeCount: airedEpisodeCount(
						entry.season,
						facts.episodeCounts[entry.season] ?? 0,
						facts.lastEpisodeToAir
					),
					coverage,
					// A release RD has already rejected for its name can only answer
					// 451 again, so it is not a candidate at all.
					packCandidates: entry.packs.filter(
						(c) => !isRdBlockedName(c.title, filenamesOf(c))
					),
					episodeCandidates,
				});
			}),
		[libraryItems]
	);

	/**
	 * Works out what the run would do, without adding anything.
	 *
	 * Packs first, because most seasons have one. Only the seasons left without
	 * a usable pack are asked for episode by episode, so the common show never
	 * pays for the per-episode payload.
	 */
	const discover = useCallback(
		async (
			service: SeasonAdderService,
			tbKey: string | null
		): Promise<SeasonAdderPlan | null> => {
			if (!show) return null;
			setDiscovering(true);
			try {
				// Specials are excluded: nobody means season zero by "all seasons".
				const seasons = Array.from({ length: show.seasonCount }, (_, i) => i + 1);
				const packSeasons = await fetchSeasons(seasons, 'packs');
				const resolvedPacks = await resolveForService(packSeasons, service, tbKey);
				let entries = buildEntries(resolvedPacks, service, show);

				const needEpisodes = entries
					.filter((entry) => entry.status === 'gap' && entry.missingEpisodes.length > 0)
					.map((entry) => entry.season);

				if (needEpisodes.length > 0) {
					const episodeSeasons = await fetchSeasons(needEpisodes, 'episodes');
					const resolvedEpisodes = await resolveForService(
						episodeSeasons,
						service,
						tbKey
					);
					const replanned = new Map(
						buildEntries(resolvedEpisodes, service, show).map((entry) => [
							entry.season,
							entry,
						])
					);
					entries = entries.map((entry) => replanned.get(entry.season) ?? entry);
				}

				entries.sort((a, b) => a.season - b.season);
				setSeasonState(
					Object.fromEntries(
						entries.map((entry) => [
							entry.season,
							entry.status === 'held'
								? 'held'
								: entry.status === 'gap'
									? 'gap'
									: 'pending',
						])
					) as Record<number, SeasonRunState>
				);
				return { service, entries, summary: summarisePlan(entries) };
			} finally {
				setDiscovering(false);
			}
		},
		[show, fetchSeasons, resolveForService, buildEntries]
	);

	/**
	 * Walks the plan one add at a time.
	 *
	 * Serial and spaced on purpose: `addRd` is three to seven Real-Debrid calls
	 * and a burst of them is what earns the 451 throttle. The run gives up
	 * rather than grind through a penalty that is not clearing, and stops the
	 * moment the page moves to another show.
	 */
	const run = useCallback(
		async (plan: SeasonAdderPlan, tbKeyPresent: boolean) => {
			stopped.current = false;
			setRunning(true);

			let added = 0;
			let failed = 0;
			let consecutiveThrottles = 0;
			let abortedByThrottle = false;
			const gaps: number[] = [];

			const markSeason = (season: number, state: SeasonRunState) =>
				setSeasonState((prev) => ({ ...prev, [season]: state }));

			const tryAdd = async (candidate: ApiCandidate): Promise<boolean> => {
				const row = asSearchResult(candidate, plan.service);
				if (plan.service === 'tb') {
					if (!tbKeyPresent) return false;
					try {
						await addTb(candidate.hash, { row, silent: true });
						consecutiveThrottles = 0;
						return true;
					} catch {
						return false;
					}
				}
				// deleteIfNotInstant: a release the availability table still
				// believes in but RD no longer serves is removed again rather than
				// left downloading in the user's account.
				const result = await addRd(candidate.hash, false, true, { row, silent: true });
				if (result === true) {
					consecutiveThrottles = 0;
					return true;
				}
				// `addRd` returns false for every failure, so the reason is gone by
				// now; a throttled add always records a rate limit on its way out.
				if (hasRecentRdRateLimits()) consecutiveThrottles++;
				return false;
			};

			try {
				for (const entry of plan.entries) {
					if (stopped.current) break;
					if (entry.status === 'held' || entry.status === 'gap') continue;

					markSeason(entry.season, 'running');

					if (entry.status === 'pack') {
						let done = false;
						for (const candidate of entry.packCandidates as ApiCandidate[]) {
							if (stopped.current) break;
							if (await tryAdd(candidate)) {
								done = true;
								break;
							}
							if (consecutiveThrottles >= THROTTLE_ABORT_AFTER) break;
							await delay(ADD_SPACING_MS);
						}
						if (done) {
							added++;
							markSeason(entry.season, 'added');
						} else if (consecutiveThrottles >= THROTTLE_ABORT_AFTER) {
							markSeason(entry.season, 'failed');
							abortedByThrottle = true;
							break;
						} else {
							failed++;
							gaps.push(entry.season);
							markSeason(entry.season, 'gap');
						}
						await delay(ADD_SPACING_MS);
						continue;
					}

					// Episode fallback: fill the gaps only, and let a release that
					// spans episodes satisfy every one it covers.
					const covered = new Set<number>();
					let addedHere = 0;
					let missedHere = 0;
					for (const episode of [...entry.episodeCandidates.keys()].sort(
						(a, b) => a - b
					)) {
						if (stopped.current) break;
						if (covered.has(episode)) continue;
						const bucket = entry.episodeCandidates.get(episode) as ApiCandidate[];
						let got = false;
						for (const candidate of bucket) {
							if (await tryAdd(candidate)) {
								for (const e of candidate.episodes ?? [episode]) covered.add(e);
								got = true;
								break;
							}
							if (consecutiveThrottles >= THROTTLE_ABORT_AFTER) break;
							await delay(ADD_SPACING_MS);
						}
						if (got) addedHere++;
						else missedHere++;
						if (consecutiveThrottles >= THROTTLE_ABORT_AFTER) break;
						await delay(ADD_SPACING_MS);
					}

					if (consecutiveThrottles >= THROTTLE_ABORT_AFTER) {
						markSeason(entry.season, 'failed');
						abortedByThrottle = true;
						break;
					}
					if (addedHere > 0) {
						added++;
						markSeason(entry.season, missedHere > 0 ? 'failed' : 'added');
					} else {
						failed++;
						gaps.push(entry.season);
						markSeason(entry.season, 'gap');
					}
				}
			} finally {
				setRunning(false);
			}

			return {
				added,
				failed,
				gaps,
				abortedByThrottle,
				stopped: stopped.current,
			};
		},
		[addRd, addTb, imdbId]
	);

	return { discover, run, stop, discovering, running, seasonState };
}
