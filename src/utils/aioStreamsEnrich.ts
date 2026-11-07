import {
	aioStreamsBase,
	scrapeAioStreamsMovie,
	scrapeAioStreamsSeason,
} from '@/services/aiostreams';
import type { ScrapeSearchResult } from '@/services/mediasearch';
import { repository as db } from '@/services/repository';
import { filterByMovieConditions, hasNoBannedTerms, meetsTitleConditions } from '@/utils/checks';
import { DebridioTarget, idIsKind } from '@/utils/debridioBackfill';

/** A page, and for a season the episode a Stremio stream request asked for. */
export type AioStreamsTarget = DebridioTarget & { episode?: number };

// ponytail: one flat day for every title. New releases of a current film can
// wait up to a day to land; shorten it for recent titles if that shows.
export const AIOSTREAMS_TTL_MS = 24 * 60 * 60 * 1000;

// A 429 pauses every replica. On the public instance an hour after launch on
// 2026-11-07, 45 of 225 requests got one; a slow or failed title does not.
export const AIOSTREAMS_COOLDOWN_MS = 15 * 60 * 1000;
const COOLDOWN_KEY = 'aiostreams:cooldown';

const stampKeyOf = (target: AioStreamsTarget) => `aiostreams:refresh:${target.key}`;

const within = (at: Date | null, ms: number) => !!at && Date.now() - at.getTime() < ms;

// Soundtracks, scores and albums share a film's name and year. A name that
// says audio and nothing of video is one: over 932,821 stored film titles on
// 2026-11-07 this matched 1,175, every sampled one music or a dub track.
const AUDIO_WORDS = /\b(soundtrack|o\.?s\.?t|flac|mp3|320\s?kbps|lossless)\b/i;
const VIDEO_WORDS =
	/\b(\d{3,4}[pi]|4k|uhd|blu-?ray|bd(rip|remux)?|br-?rip|web-?(dl|rip)?|hdtv|dvd(rip|5|9)?|remux|x26[45]|h\.?26[45]|hevc|avc|xvid|divx|hdr|mkv|mp4|avi|cam|hdvcam|hdts|hdcam|telesync|hdrip)\b/i;
const isAudioRelease = (title: string) => AUDIO_WORDS.test(title) && !VIDEO_WORDS.test(title);

/**
 * The checks DMM's own scrapers put a name-searched release through: the title
 * and year against IMDb's title or original title, the banned words (`XXX`
 * parodies of the same name), and for a film the movie scraper's conditions
 * (no episode markers, 500 MB to 250 GB); and no soundtracks. A title IMDb does
 * not have keeps none.
 */
export async function releaseCheck(
	imdbId: string,
	kind: AioStreamsTarget['kind']
): Promise<(release: ScrapeSearchResult) => boolean> {
	const info = await db.getImdbTitleById(imdbId);
	if (!info) return () => false;
	const names = [...new Set([info.title, info.originalTitle].filter(Boolean))] as string[];
	const years = info.year ? [String(info.year)] : [];
	return (release) =>
		names.some(
			(name) =>
				meetsTitleConditions(name, years, release.title) &&
				hasNoBannedTerms(name.toLowerCase(), release.title)
		) &&
		!isAudioRelease(release.title) &&
		(kind !== 'movie' || filterByMovieConditions([release]).length === 1);
}

/**
 * Adds what AIOStreams knows about a title to its ScrapedTrue page, at most
 * once a day per page: one request, for a season the episode Stremio asked for
 * or the first. Merges, never replaces. The stamp is written before the scrape,
 * so the four web replicas seeing the same title at once send one request, not
 * four, and a replica that loses the race to write it leaves the title to the
 * winner. A failed scrape waits for the next day like an empty one; a refused
 * one (429) also pauses every title for the cooldown. Returns how many
 * releases it handed over.
 */
export async function enrichFromAioStreams(target: AioStreamsTarget): Promise<number> {
	const base = aioStreamsBase();
	if (!base) return 0;
	if (within(await db.getRefreshedAt(COOLDOWN_KEY), AIOSTREAMS_COOLDOWN_MS)) return 0;
	const stampKey = stampKeyOf(target);
	if (within(await db.getRefreshedAt(stampKey), AIOSTREAMS_TTL_MS)) return 0;
	try {
		await db.markRefreshed(stampKey);
	} catch (error) {
		// Another replica created the same stamp a moment ago: its request covers this.
		if ((error as { code?: string })?.code === 'P2002') return 0;
		throw error;
	}
	if (!(await idIsKind(target))) return 0;

	const keep = await releaseCheck(target.imdbId, target.kind);
	let scrape;
	try {
		scrape =
			target.kind === 'movie'
				? await scrapeAioStreamsMovie(base, target.imdbId, keep)
				: // ponytail: one episode per season a day - packs and that episode's own
					// releases. Every episode would put a season's worth of requests on
					// Comet, Torrentio and the rest from one IP.
					await scrapeAioStreamsSeason(
						base,
						target.imdbId,
						target.season ?? 1,
						[target.episode ?? 1],
						keep
					);
	} catch (error) {
		if (error instanceof Error && /\b429\b/.test(error.message)) {
			await db.markRefreshed(COOLDOWN_KEY);
		}
		throw error;
	}
	if (scrape.torrents.length > 0) {
		await db.saveScrapedTrueResults(target.key, scrape.torrents, true);
	}
	console.log(`[aiostreams] ${stampKeyOf(target)}: ${scrape.torrents.length} releases`);
	return scrape.torrents.length;
}

/** Fire and forget for request handlers: never throws, never holds the response. */
export function enrichFromAioStreamsInBackground(target: AioStreamsTarget): void {
	enrichFromAioStreams(target).catch((error) =>
		console.warn(
			`[aiostreams] enrich failed for ${stampKeyOf(target)}:`,
			error instanceof Error ? error.message : error
		)
	);
}
