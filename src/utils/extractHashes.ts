// Shared regex for SHA1 hash validation
export const SHA1_REGEX = /^[a-fA-F0-9]{40}$/;

export function isValidHash(hash: string): boolean {
	return SHA1_REGEX.test(hash);
}

export function normalizeHash(hash: string | undefined | null): string {
	if (!hash || typeof hash !== 'string') return '';
	return isValidHash(hash) ? hash.toLowerCase() : '';
}

export function extractHashes(hashesStr: string): string[] {
	const results = new Set<string>();

	// Extract from magnet URIs
	const magnetMatches = hashesStr.match(/btih:([a-fA-F0-9]{40})/gi);
	if (magnetMatches) {
		magnetMatches.forEach((match) => {
			const hash = match.substring(5).toLowerCase(); // Remove 'btih:' prefix
			results.add(hash);
		});
	}

	// Extract standalone hashes
	const hashMatches = hashesStr.match(/\b[a-fA-F0-9]{40}\b/g);
	if (hashMatches) {
		hashMatches.forEach((hash) => results.add(hash.toLowerCase()));
	}

	return Array.from(results);
}

// Direct/hoster download links, one per line or whitespace separated. Magnets
// are left out on purpose: those belong to the torrent path, not the web
// download one.
export function extractDownloadLinks(linksStr: string): string[] {
	const results = new Set<string>();
	for (const token of linksStr.split(/\s+/)) {
		const link = token.trim().replace(/[.,;]+$/, '');
		if (/^https?:\/\/\S+$/i.test(link)) results.add(link);
	}
	return Array.from(results);
}

export function extractMagnets(hashesStr: string): string[] {
	// Extract existing magnets or convert hashes to magnets
	const magnetMatches = hashesStr.match(/magnet:\?[^\s"']*/gi);
	if (magnetMatches) return magnetMatches;

	const hashes = extractHashes(hashesStr);
	return hashes.map((hash) => `magnet:?xt=urn:btih:${hash}`);
}
