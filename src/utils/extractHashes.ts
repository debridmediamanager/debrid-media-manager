export function extractHashes(hashesStr: string): string[] {
	const hashRegex = /\b[a-f0-9]{40}\b/gi;
	const matches = hashesStr.match(hashRegex);
	return matches || [];
}
