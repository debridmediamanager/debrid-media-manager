export const getColorScale = (expectedEpisodeCount: number) => {
	const scale = [
		{ threshold: 1, color: 'gray-800', label: 'Single' },
		{ threshold: expectedEpisodeCount - 1, color: 'purple-800', label: 'Incomplete' },
		{ threshold: expectedEpisodeCount, color: 'green-900', label: 'Complete' },
		{ threshold: Infinity, color: 'blue-900', label: 'With extras' },
	];
	return scale;
};

export const getQueryForEpisodeCount = (videoCount: number, expectedEpisodeCount: number) => {
	if (videoCount === 1) return 'videos:1'; // Single episode
	if (videoCount === expectedEpisodeCount) return `videos:${expectedEpisodeCount}`; // Complete
	if (videoCount < expectedEpisodeCount) return `videos:>1 videos:<${expectedEpisodeCount}`; // Incomplete
	return `videos:>${expectedEpisodeCount}`; // With extras
};

// Complete literals are required for CSS source detection, including opacity.
const episodeBackgroundClasses: Record<string, string> = {
	'gray-800': 'bg-gray-800/30',
	'purple-800': 'bg-purple-800/30',
	'green-900': 'bg-green-900/30',
	'blue-900': 'bg-blue-900/30',
};

export const getEpisodeCountClass = (
	videoCount: number,
	expectedEpisodeCount: number,
	isInstantlyAvailable: boolean
) => {
	if (!isInstantlyAvailable) return ''; // No color for unavailable torrents
	const scale = getColorScale(expectedEpisodeCount);
	for (let i = 0; i < scale.length; i++) {
		if (videoCount <= scale[i].threshold) {
			return episodeBackgroundClasses[scale[i].color];
		}
	}
	return episodeBackgroundClasses[scale[scale.length - 1].color];
};

export const getEpisodeCountLabel = (videoCount: number, expectedEpisodeCount: number) => {
	if (videoCount === 1) return `Single`;
	if (videoCount < expectedEpisodeCount)
		return `Incomplete (${videoCount}/${expectedEpisodeCount})`;
	if (videoCount === expectedEpisodeCount)
		return `Complete (${videoCount}/${expectedEpisodeCount})`;
	return `With extras (${videoCount}/${expectedEpisodeCount})`;
};

export const getExpectedEpisodeCount = (
	seasonNum: string | undefined,
	counts: Record<number, number>
) => {
	if (!seasonNum) return 13;
	const num = parseInt(seasonNum);
	return counts[num] || 13;
};
