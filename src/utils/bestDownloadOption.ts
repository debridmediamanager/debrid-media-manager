import { HashAvailability } from '@/services/availability';

export const getBestDownloadOption = (
	searchResults: { hash: string; score: number }[],
	masterAvailability: HashAvailability
): string | undefined => {
	if (!searchResults.length) return;
	const availableHashes = Object.keys(masterAvailability).filter((key) =>
		masterAvailability[key].endsWith(':available')
	);
	if (!availableHashes.length) return;
	let bestScore = 0;
	const bestHash = availableHashes.reduce((acc: string, curr: string) => {
		const currScore = searchResults.find((r) => r.hash === curr)?.score || 0;
		if (currScore > bestScore) {
			bestScore = currScore;
			return curr;
		}
		return acc;
	}, availableHashes[0]);
	return bestHash;
};
