import { TorrentInfoResponse } from '@/services/types';

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

export function getSelectableFiles(files: TorrentInfoResponse['files']) {
	// const maxFileSize = Math.max(...files.map((obj) => obj.bytes));
	// return files.filter(
	// 	(f) => f.bytes >= maxFileSize * FILE_SIZE_PCT_THRESHOLD || /[ex][0123]\d/i.test(f.path)
	// );
	return files;
}

function hasIncreasingSequence(arr: number[]): boolean {
	if (arr.length < 3) {
		return false;
	}
	for (let i = 0; i < arr.length - 2; i++) {
		if (arr[i] < arr[i + 1] && arr[i + 1] < arr[i + 2]) {
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
			if (hasIncreasingSequence(numList)) {
				return true;
			}
		}
	}

	return false;
}
