import ptt from 'parse-torrent-title';

export type PlannedCast<T> = {
	file: T;
	/** The Stremio id this file is served under. */
	stremioKey: string;
	season?: number;
	episode?: number;
};

type Describe<T> = (file: T) => { filename: string; size: number };

const episodeOf = (filename: string) => {
	const info = ptt.parse(filename.split('/').pop() || filename);
	return info.season != null && info.episode != null
		? { season: info.season, episode: info.episode }
		: null;
};

/**
 * Keeps one file per episode: the biggest.
 *
 * The cast tables are unique on `(imdbId, userId, hash)`, so two files of one
 * release that parse to the same episode are written to the same row and the
 * second replaces the first. An Internet Archive torrent always has such a pair:
 * the Archive derives a compressed .mp4 from every uploaded .mkv under the same
 * name, and the derivative sorts after its source, so a cast loop kept the
 * copy. Biggest is the same call the movie key already makes for extras, and it
 * is the source over its re-encode and 1080p over 720p in a mixed pack.
 *
 * Files with no season and episode are returned unchanged and in place: what to
 * do with those is the caller's decision.
 */
export const oneFilePerEpisode = <T>(files: T[], describe: Describe<T>): T[] => {
	const keys = files.map((file) => {
		const episode = episodeOf(describe(file).filename);
		return episode ? `${episode.season}:${episode.episode}` : null;
	});
	const biggest = new Map<string, number>();
	keys.forEach((key, index) => {
		if (key === null) return;
		const current = biggest.get(key);
		if (current === undefined || describe(files[index]).size > describe(files[current]).size) {
			biggest.set(key, index);
		}
	});
	return files.filter((_, index) => keys[index] === null || biggest.get(keys[index]!) === index);
};

/**
 * Decides which files a library cast writes, and under which Stremio id.
 *
 * The cast tables are unique on `(imdbId, userId, hash)`, so every file that
 * lands on the same key overwrites the one before it. A movie with extras, a
 * featurette reel or a BDMV has no suffix to give, so the old loop wrote every
 * video file to the bare imdb id and kept only whichever happened to be last.
 * A cast of a 102-stream BDMV left one row, pointing at an Extras disc. Two
 * files of the same episode collide the same way under their `:season:episode`
 * key; see `oneFilePerEpisode`.
 *
 * So: every episode is written under its own key, once, and the files with no
 * episode of their own contribute exactly one row - the biggest, which is the
 * feature rather than a trailer. That also stops the caller minting N-1
 * download links it is about to throw away.
 *
 * `info.season && info.episode` was the old test, which reads season 0 and
 * episode 0 as absent and drops specials onto the movie key with everything
 * else; a present-check keeps them.
 */
export const planLibraryCast = <T>(
	imdbId: string,
	files: T[],
	describe: Describe<T>
): PlannedCast<T>[] => {
	const planned: PlannedCast<T>[] = [];
	const featureless: { file: T; size: number }[] = [];

	for (const file of oneFilePerEpisode(files, describe)) {
		const { filename, size } = describe(file);
		const info = episodeOf(filename);
		if (info) {
			planned.push({
				file,
				stremioKey: `${imdbId}:${info.season}:${info.episode}`,
				season: info.season,
				episode: info.episode,
			});
		} else {
			featureless.push({ file, size });
		}
	}

	if (featureless.length > 0) {
		const biggest = featureless.reduce((prev, current) =>
			prev.size >= current.size ? prev : current
		);
		planned.push({ file: biggest.file, stremioKey: imdbId });
	}

	return planned;
};
