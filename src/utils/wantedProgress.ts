/** One season of a show's snapshot as the wanted list carries it. */
export interface SeasonProgress {
	season: number;
	have: number;
	missing: number[];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const episodeCode = (season: number, episode: number) => `S${pad(season)}E${pad(episode)}`;

/**
 * A show's snapshot in one line: `9/10 · S01E07 missing`. Up to two missing
 * episodes are named, more are counted. Empty when zurg has not reported yet.
 */
export function progressLabel(progress: SeasonProgress[] | undefined): string {
	if (!progress?.length) return '';
	const missing = progress.flatMap((s) => s.missing.map((e) => episodeCode(s.season, e)));
	const have = progress.reduce((n, s) => n + s.have, 0);
	const count = `${have}/${have + missing.length}`;
	if (!missing.length) return count;
	return `${count} · ${missing.length > 2 ? missing.length.toLocaleString('en-US') : missing.join(', ')} missing`;
}

/** Episode numbers as ranges: `1-3, 7`. */
export function episodeRanges(episodes: number[]): string {
	const out: string[] = [];
	const sorted = [...episodes].sort((a, b) => a - b);
	for (let i = 0; i < sorted.length; i++) {
		let j = i;
		while (sorted[j + 1] === sorted[j] + 1) j++;
		out.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
		i = j;
	}
	return out.join(', ');
}

/** zurg's reason codes in plain words. A code this page does not know is shown as it is. */
export const REASON_WORDS: Record<string, string> = {
	wrong_content: 'Not what its name says',
	no_video: 'No video in it',
	sample: 'Only a sample',
	missing_articles: 'Articles missing on Usenet',
	provider_gave_up: 'The provider gave up on it',
	unreadable_nzb: 'The NZB could not be read',
	password: 'Password-protected',
	quality: 'Not the quality you set',
	language: 'Not a language you set',
	size: 'Outside your size limits',
	excluded: 'Matches one of your exclusions',
	provider_refused: 'The provider refused it',
	add_failed: 'Could not be added',
	fetch_failed: 'Could not be fetched',
	upgraded: 'Replaced by a better release',
	nothing_found: 'Nothing found',
	nothing_passed: 'Nothing passed your rules',
	indexers_benched: 'Indexers were unavailable',
	other: 'Other',
};

export const KIND_WORDS: Record<string, string> = {
	grabbed: 'Grabbed',
	rejected: 'Rejected',
	failed: 'Nothing taken',
	removed: 'Removed',
};
