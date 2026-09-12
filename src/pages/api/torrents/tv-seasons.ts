import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import {
	filterSeasonEpisodes,
	filterSeasonPacks,
	type SeasonEpisodeCandidate,
	type SeasonPackCandidate,
} from '@/utils/cachedTroveStreams';
import { checkCanary } from '@/utils/canaryGuard';
import { validateProblemToken } from '@/utils/problemToken';
import { isVideo } from '@/utils/selectable';
import { NextApiHandler } from 'next';

/**
 * Every season of one show, resolved in a single request.
 *
 * The season page's own search answers one season and is rate limited at one
 * request every two seconds per IP, which is the right budget for a person
 * clicking through seasons and the wrong one for an action that means "all of
 * them" - a twenty-season show would spend forty seconds in the bucket before
 * anything could be added, and spend it from a budget shared with everyone
 * behind that IP. This reads the season rows directly instead.
 *
 * Two modes, because most seasons never need the second. `packs` answers the
 * releases that claim a whole season, which is what the run wants and usually
 * gets. `episodes` is asked for afterwards, naming only the seasons that had no
 * usable pack, so the common show never pays for the per-episode payload.
 *
 * `ScrapedTrue` only, never `Scraped`: this feeds an automated add, and
 * `Scraped` carries fabricated titles on real hashes.
 */

/** A season with more than this many episodes is a parsing artefact, not a season. */
const MAX_EPISODES_PER_SEASON = 200;
/** Shows run long, but not this long; the cap bounds the row reads per request. */
const MAX_SEASONS = 50;

type ResolvedCandidate = {
	hash: string;
	title: string;
	sizeMb: number;
	rdAvailable: boolean;
	/** Video files RD recorded for this hash; absent when RD has never held it. */
	videoCount?: number;
	files?: { fileId: number; filename: string; filesize: number }[];
	/** Seasons the title claims, on a pack. */
	seasons?: number[];
	/** Episodes the title claims, on an episode release. */
	episodes?: number[];
};

const parseSeasons = (raw: unknown): number[] | null => {
	if (typeof raw !== 'string' || raw.length === 0) return null;
	const seasons: number[] = [];
	for (const part of raw.split(',')) {
		const season = Number.parseInt(part.trim(), 10);
		// Season zero is the specials page; the run excludes it, and letting it
		// through here would only read a row nothing asks for.
		if (!Number.isInteger(season) || season < 1 || season > 1000) return null;
		if (!seasons.includes(season)) seasons.push(season);
	}
	if (seasons.length === 0 || seasons.length > MAX_SEASONS) return null;
	return seasons;
};

const handler: NextApiHandler = async (req, res) => {
	const {
		imdbId,
		seasons: rawSeasons,
		mode,
		dmmProblemKey,
		solution,
		onlyTrusted,
		maxSize,
	} = req.query;

	if (
		!dmmProblemKey ||
		!(typeof dmmProblemKey === 'string') ||
		!solution ||
		!(typeof solution === 'string')
	) {
		res.status(403).json({ errorMessage: 'Authentication not provided' });
		return;
	} else if (!validateProblemToken(dmmProblemKey, solution)) {
		res.status(403).json({ errorMessage: 'Authentication error' });
		return;
	}

	if (!imdbId || typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId.trim())) {
		res.status(400).json({ errorMessage: 'Missing or invalid "imdbId" query parameter' });
		return;
	}
	const trimmedImdbId = imdbId.trim();

	// An id no browser session can produce is proof of enumeration, and this
	// route would otherwise read fifty rows for one. Answer as an unscraped
	// title does, and queue nothing.
	if (await checkCanary(req, trimmedImdbId)) {
		res.status(200).json({ seasons: [] });
		return;
	}

	const seasons = parseSeasons(rawSeasons);
	if (!seasons) {
		res.status(400).json({ errorMessage: 'Missing or invalid "seasons" query parameter' });
		return;
	}

	const wantEpisodes = mode === 'episodes';
	const maxSizeGb = maxSize ? parseInt(maxSize.toString(), 10) : 0;

	try {
		// `onlyTrusted` is accepted for symmetry with the season search, but this
		// route never reads the untrusted pool either way - see the note above.
		void onlyTrusted;

		const reportedHashes = new Set(await db.getReportedHashes(trimmedImdbId));

		const perSeason = await Promise.all(
			seasons.map(async (season) => {
				const rows = await db.getAllScrapedTrueResults(`tv:${trimmedImdbId}:${season}`);
				const usable = (rows ?? []).filter(
					(row) => !row?.hash || !reportedHashes.has(row.hash)
				);
				if (wantEpisodes) {
					return {
						season,
						packs: [] as SeasonPackCandidate[],
						episodes: filterSeasonEpisodes(usable, { season, maxSizeGb }),
					};
				}
				return {
					season,
					packs: filterSeasonPacks(usable, { season, maxSizeGb }),
					episodes: new Map<number, SeasonEpisodeCandidate[]>(),
				};
			})
		);

		// One availability read for the whole show: `Available` is keyed by imdb
		// id rather than by season, so splitting this per season would only cost
		// more queries for the same rows.
		const allHashes = new Set<string>();
		for (const entry of perSeason) {
			for (const pack of entry.packs) allHashes.add(pack.hash);
			for (const bucket of entry.episodes.values()) {
				for (const candidate of bucket) allHashes.add(candidate.hash);
			}
		}

		const availability =
			allHashes.size > 0 ? await db.checkAvailability(trimmedImdbId, [...allHashes]) : [];
		const availableByHash = new Map(
			availability.map((row) => [row.hash.toLowerCase(), row.files] as const)
		);

		const resolve = (
			candidate: SeasonPackCandidate | SeasonEpisodeCandidate
		): ResolvedCandidate => {
			const files = availableByHash.get(candidate.hash.toLowerCase());
			const resolved: ResolvedCandidate = {
				hash: candidate.hash,
				title: candidate.title,
				sizeMb: candidate.sizeMb,
				rdAvailable: !!files,
			};
			if ('seasons' in candidate) resolved.seasons = candidate.seasons;
			if ('episodes' in candidate) resolved.episodes = candidate.episodes;
			if (files) {
				// The window that decides "this release is the season" counts
				// videos, not files: a pack ships subtitles, samples and NFOs.
				resolved.videoCount = files.filter((file) => isVideo({ path: file.path })).length;
				resolved.files = files.map((file) => ({
					fileId: file.file_id,
					filename: file.path,
					filesize: Number(file.bytes),
				}));
			}
			return resolved;
		};

		res.status(200).json({
			seasons: perSeason.map((entry) => ({
				season: entry.season,
				packs: entry.packs.map(resolve),
				episodes: Object.fromEntries(
					[...entry.episodes.entries()]
						.filter(([episode]) => episode >= 1 && episode <= MAX_EPISODES_PER_SEASON)
						.map(([episode, bucket]) => [episode, bucket.map(resolve)])
				),
			})),
		});
	} catch (error: any) {
		console.error(
			'Encountered a database issue resolving seasons:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ errorMessage: 'An internal error occurred' });
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.tvSeasons);
