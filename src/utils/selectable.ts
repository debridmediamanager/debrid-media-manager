const FILE_SIZE_PCT_THRESHOLD = 0.15;

export function isVideo(file: { path: string }) {
	const filePath = `${file.path}`.toLowerCase();
	if (filePath.startsWith('/rarbg') || filePath.startsWith('rarbg')) return false;
	if (filePath.match(/\bsample\b/)) return false;
	if (filePath.match(/\btrailer\b/)) return false;
	return (
		// filePath.endsWith('.3gp') || // confirmed NOT working
		// filePath.endsWith('.asf') || // not yet confirmed working
		// filePath.endsWith('.asx') || // not yet confirmed working
		// filePath.endsWith('.avc') || // not yet confirmed working
		filePath.endsWith('.avi') || // confirmed working
		// filePath.endsWith('.divx') || // not yet confirmed working
		filePath.endsWith('.flv') || // confirmed working
		filePath.endsWith('.m2ts') || // confirmed working
		filePath.endsWith('.m4v') || // confirmed working
		filePath.endsWith('.mkv') || // confirmed working
		filePath.endsWith('.mov') || // confirmed working
		filePath.endsWith('.mp4') || // confirmed working
		filePath.endsWith('.mpg') || // confirmed working (no watch option)
		filePath.endsWith('.mpeg') || // confirmed working (no watch option)
		filePath.endsWith('.ts') || // confirmed working
		filePath.endsWith('.mp3') || // confirmed working
		filePath.endsWith('.flac') || // confirmed working
		filePath.endsWith('.m4a') || // confirmed working
		// filePath.endsWith('.vob') || // not yet confirmed working
		filePath.endsWith('.webm') || // confirmed working
		filePath.endsWith('.wmv') // confirmed working
	);
}

// Years and resolutions sit at the same offset across a movie pack just as
// readily as episode numbers do, so numbers in these ranges don't count as
// evidence of an episode run
const YEAR_LIKE_MIN = 1900;
const YEAR_LIKE_MAX = 2100;

/**
 * True when the numbers contain a run of at least three consecutive integers.
 *
 * The caller hands this a de-duplicated, ascending list, which is why the old
 * "is each one bigger than the last" test always passed: sorted distinct numbers
 * are increasing by definition. That made every group of three numbers at a
 * shared offset look like episodes - a trilogy's release years, three different
 * resolutions - so movie packs were filed as TV shows.
 */
function hasConsecutiveRun(arr: number[]): boolean {
	const candidates = arr.filter((n) => n < YEAR_LIKE_MIN || n > YEAR_LIKE_MAX);
	if (candidates.length < 3) {
		return false;
	}
	let run = 1;
	for (let i = 1; i < candidates.length; i++) {
		run = candidates[i] === candidates[i - 1] + 1 ? run + 1 : 1;
		if (run >= 3) {
			return true;
		}
	}
	return false;
}

export function checkArithmeticSequenceInFilenames(files: string[]): boolean {
	if (files.length < 3) {
		return false;
	}

	const r = new RegExp('\\d+', 'g');

	for (const file of files) {
		if (!isVideo({ path: file })) {
			continue;
		}

		let matches;
		while ((matches = r.exec(file)) !== null) {
			const match = matches.index;
			const numSet = new Map<number, null>();

			for (const f of files) {
				if (!isVideo({ path: f })) {
					continue;
				}

				if (match >= 0 && match < f.length) {
					const numStr = f.slice(match, match + matches[0].length);
					const num = parseInt(numStr, 10);

					if (!isNaN(num)) {
						numSet.set(num, null);
					}
				} else {
					// out of bounds, ignore
					continue;
				}
			}

			const numList: number[] = Array.from(numSet.keys());
			numList.sort((a, b) => a - b);
			if (hasConsecutiveRun(numList)) {
				return true;
			}
		}
	}

	return false;
}
