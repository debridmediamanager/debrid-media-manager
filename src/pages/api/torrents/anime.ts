import {
	flattenAndRemoveDuplicates,
	ScrapeSearchResult,
	sortByFileSize,
} from '@/services/mediasearch';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import {
	AnimeEpisodeFilter,
	AnimeEpisodeSummary,
	matchesAnimeEpisodeFilter,
	parseAnimeEpisodeFilter,
	summarizeAnimeEpisodes,
} from '@/utils/animeEpisodes';
import { validateProblemToken } from '@/utils/problemToken';
import { NextApiHandler } from 'next';

/** Matches the page size of `getScrapedTrueResults`, which the other routes use. */
const PAGE_SIZE = 50;

/**
 * One stored release, in either shape an `anime:*` row holds.
 *
 * Every anime row in production on 2026-09-27 (16,602 of them) stores
 * `{hash, filename, size_bytes}`; movie and TV rows, and whatever the scrapers'
 * shared pipeline appends to an existing array, store `{hash, title, fileSize}`.
 * Both sizes are MiB, whatever the legacy field's name says.
 */
interface StoredRelease {
	hash?: unknown;
	title?: unknown;
	fileSize?: unknown;
	filename?: unknown;
	size_bytes?: unknown;
}

function toSearchResult(entry: StoredRelease): ScrapeSearchResult | null {
	if (!entry || typeof entry.hash !== 'string') return null;
	const title =
		typeof entry.title === 'string' && entry.title.trim() !== ''
			? entry.title
			: typeof entry.filename === 'string'
				? entry.filename
				: '';
	// A Cyrillic-led name stays, as on the movie and season pages: these rows are
	// trusted, and "Письмо для Момо / Momo e no Tegami / A Letter to Momo" is that
	// film's own release.
	if (title.trim() === '') return null;
	const size = Number(entry.fileSize ?? entry.size_bytes);
	return { hash: entry.hash, title, fileSize: Number.isFinite(size) ? size : 0 };
}

/**
 * The whole row, read once and paged here.
 *
 * `getScrapedTrueResults` pages in SQL through a JSON_TABLE that projects only
 * `$.title` and `$.fileSize`. Against the legacy shape every entry comes back
 * with a null title, which its title filter then drops, so this route answered
 * 204 for every anime in the table — Frieren's row alone holds 772 releases.
 */
async function readReleases(
	key: string,
	page: number,
	episode: AnimeEpisodeFilter | null
): Promise<{ results: ScrapeSearchResult[]; episodes?: AnimeEpisodeSummary }> {
	const stored = ((await db.getAllScrapedTrueResults(key)) ?? []) as StoredRelease[];
	const releases = stored.map(toSearchResult).filter((r): r is ScrapeSearchResult => r !== null);
	const sorted = sortByFileSize(flattenAndRemoveDuplicates([releases]));
	const matching =
		episode === null
			? sorted
			: sorted.filter((r) => matchesAnimeEpisodeFilter(r.title, episode));
	const results = matching.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
	// Pages are sorted by size, so page 0 of Frieren's 772 releases is all packs
	// and a single episode sits pages deep. The summary covers the whole row, so
	// the page can offer every episode without paging through to find them.
	if (page !== 0) return { results };
	return { results, episodes: summarizeAnimeEpisodes(sorted.map((r) => r.title)) };
}

/**
 * Returns the scraped releases for an anime id.
 *
 * An anime nothing has scraped answers an empty list. It used to be written to
 * the request queue as `requested:<animeId>`, but that queue is read only for
 * `requested:tt*` and no scraper marks an anime id `processing:`, so each such
 * view left a row nothing would ever act on. Anime rows are filled by the
 * scrapers on their own schedule, not on demand.
 */
const handler: NextApiHandler = async (req, res) => {
	const { animeId, dmmProblemKey, solution, page, episode } = req.query;

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

	if (!animeId || !(typeof animeId === 'string')) {
		res.status(400).json({ errorMessage: 'Missing "animeId" query parameter' });
		return;
	}

	const pageNum = page ? parseInt(page.toString(), 10) : 0;
	if (!Number.isInteger(pageNum) || pageNum < 0) {
		res.status(400).json({ errorMessage: 'Invalid "page" query parameter' });
		return;
	}

	const episodeFilter = parseAnimeEpisodeFilter(episode);
	if (episode !== undefined && episodeFilter === null) {
		res.status(400).json({ errorMessage: 'Invalid "episode" query parameter' });
		return;
	}

	try {
		const served = await readReleases(
			`anime:${animeId.toString().trim()}`,
			pageNum,
			episodeFilter
		);
		res.status(200).json(served);
	} catch (error: any) {
		console.error(
			'Encountered a database issue:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ errorMessage: 'An internal error occurred' });
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.torrents);
