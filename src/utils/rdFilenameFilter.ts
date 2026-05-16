const BLOCKED_SUBSTRINGS = ['web-dl', 'webrip', 'bdrip', 'hdrip', 'dvdrip'];

const BLOCKED_DOT_PAIRS: [string, string][] = [
	['bluray', 'x264'],
	['hdtv', 'x264'],
	['hdtv', 'xvid'],
	['web', 'x264'],
	['web', 'h264'],
];

export function isRdBlockedFilename(filename: string): boolean {
	const lower = filename.toLowerCase();

	for (const substr of BLOCKED_SUBSTRINGS) {
		if (lower.includes(substr)) return true;
	}

	for (const [source, codec] of BLOCKED_DOT_PAIRS) {
		if (lower.includes(`.${source}.${codec}`)) return true;
	}

	return false;
}
