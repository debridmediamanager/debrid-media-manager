import ptt from 'parse-torrent-title';

export type PlannedCast<T> = {
	file: T;
	/** The Stremio id this file is served under. */
	stremioKey: string;
	season?: number;
	episode?: number;
};

/**
 * Decides which files a library cast writes, and under which Stremio id.
 *
 * The cast tables are unique on `(imdbId, userId, hash)`, so every file that
 * lands on the same key overwrites the one before it. Episodes are fine - each
 * carries its own `:season:episode` suffix - but a movie with extras, a
 * featurette reel or a BDMV has no suffix to give, so the old loop wrote every
 * video file to the bare imdb id and kept only whichever happened to be last.
 * A cast of a 102-stream BDMV left one row, pointing at an Extras disc.
 *
 * So: every episode is written under its own key, and the files with no
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
	describe: (file: T) => { filename: string; size: number }
): PlannedCast<T>[] => {
	const planned: PlannedCast<T>[] = [];
	const featureless: { file: T; size: number }[] = [];

	for (const file of files) {
		const { filename, size } = describe(file);
		const info = ptt.parse(filename.split('/').pop() || filename);
		if (info.season != null && info.episode != null) {
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
