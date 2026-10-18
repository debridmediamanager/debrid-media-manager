// content-identifier names the IMDb movie or show a release filename is (its own repository,
// running on dmm-01 over Tailscale). Configure CONTENT_IDENTIFIER_URL and
// CONTENT_IDENTIFIER_TOKEN; unset, identification is simply unavailable.

export interface IdentifierMatch {
	imdbId: string;
	title: string;
	year: number | null;
	score: number;
}

/** Whether a name is a movie or a show; the service decides. */
export type IdentifierKind = 'movie' | 'tv';

export interface IdentifierResult {
	kind?: IdentifierKind;
	/** The service's probability that the first match is right. */
	probability?: number;
	/** The title the service read from the filename. */
	parsedTitle?: string;
	/** The year the filename names, if any. */
	parsedYear?: number | null;
	/** The first match clears the service's calibrated precision bar. */
	confident: boolean;
	matches: IdentifierMatch[];
}

/** The service's own batch ceiling. */
const SERVICE_BATCH = 1000;
/** A 1,000-name batch takes about 8 s on dmm-01 per kind, and both kinds are asked. */
const TIMEOUT_MS = 30_000;

/** One result per filename, in order, or null when the service cannot be reached. */
export async function identifyFilenames(filenames: string[]): Promise<IdentifierResult[] | null> {
	const base = process.env.CONTENT_IDENTIFIER_URL?.replace(/\/+$/, '');
	if (!base) return null;
	const results: IdentifierResult[] = [];
	for (let at = 0; at < filenames.length; at += SERVICE_BATCH) {
		try {
			const response = await fetch(`${base}/identify/batch`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-identifier-token': process.env.CONTENT_IDENTIFIER_TOKEN ?? '',
				},
				body: JSON.stringify({
					filenames: filenames.slice(at, at + SERVICE_BATCH),
					kind: 'auto',
				}),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!response.ok) {
				console.error(`content-identifier answered ${response.status}`);
				return null;
			}
			results.push(...((await response.json()) as { results: IdentifierResult[] }).results);
		} catch (error) {
			console.error('content-identifier unreachable:', (error as Error).message);
			return null;
		}
	}
	return results;
}

// Release shapes the service names confidently and wrongly, each seen in production
// (2026-10-12): `The Dirty Harry Collection (1971-1988)` as The Dead Pool, an album
// (`MUSE Simulation Theory [DELUXE] FLAC CD 2018`) as the band's concert film, and
// `PKPD-234.mp4` as Unit 234. A box set has no single year: `The Collection 2012` and
// `Seven.Samurai.1954.Criterion.Collection` are films ("Triology" is how one Matrix
// box set spells it). Concert videos carry a video tag.
const BOX_SET = /\b(?:collection|trio?logy|quadrilogy|saga|anthology|\d+[- ]?films?)\b/i;
const AUDIO = /\b(?:flac|mp3|alac|\d{2}[- ]?bit|\d+(?:\.\d+)?[- ]?khz|\d+[- ]?kbps|discography)\b/i;
export const VIDEO =
	/\b(?:\d{3,4}[pi]|4k|uhd|blu-?ray|bd(?:rip|remux)?|br-?rip|web(?:-?dl|-?rip)?|hdtv|dvd\w*|remux|[xh]\.?26[45]|hevc|avc|xvid|divx|mkv|mp4|avi)\b/i;
const JAV_CODE = /^(?:[\w.-]+@)?[a-z]{2,6}-\d{3,5}(?:\.\w{2,4})?$/i;
// A film's festival and release years can be 2-3 apart (Cannibal! The Musical is
// 1993 on IMDb and 1996 on its releases); remakes the service confuses are decades.
const MOVIE_YEAR_SLACK = 3;

/** Whether no answer for this name should be shown, however sure the service is. */
export function refused(filename: string, answer: IdentifierResult): boolean {
	if (answer.kind === 'tv') return false;
	const year = answer.parsedYear;
	const top = answer.matches[0];
	return (
		(BOX_SET.test(filename) && !year && !namesItself(answer)) ||
		(AUDIO.test(filename) && !VIDEO.test(filename)) ||
		JAV_CODE.test(filename.trim()) ||
		Boolean(year && top?.year && Math.abs(year - top.year) > MOVIE_YEAR_SLACK)
	);
}

/**
 * The answer's title is the name's own, as for `Tom and Jerry The Golden Era
 * Anthology 1940-1958`, a set IMDb lists as one title. A documentary about a set
 * (The Fire Rises: ... the Dark Knight Trilogy) is not.
 */
function namesItself(answer: IdentifierResult): boolean {
	const letters = (text = '') => text.toLowerCase().replace(/[^a-z]/g, '');
	const title = letters(answer.matches[0]?.title);
	return Boolean(title) && title === letters(answer.parsedTitle);
}
