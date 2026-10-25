import { formatReleaseDate, isIsoDateOnOrBeforeToday } from '@/utils/movieReleaseDates';

// One compact line of facts for the movie/show info pages, with empty or zero values left out
// rather than rendered as "0h 0m" or "0.0/10 (0 votes)".

const formatCount = (count: number) =>
	count >= 1_000_000
		? `${(count / 1_000_000).toFixed(1)}M`
		: count >= 1000
			? `${(count / 1000).toFixed(1)}k`
			: String(count);

const ratingPart = (voteAverage: number, voteCount: number) =>
	voteCount > 0 ? `★ ${voteAverage.toFixed(1)} (${formatCount(voteCount)})` : '';

export function movieMetaParts(
	movie: {
		releaseDate: string;
		expectedDigitalReleaseDate: string;
		expectedDigitalReleaseSource: 'tmdb' | 'estimated' | null;
		runtime: number;
		voteAverage: number;
		voteCount: number;
	},
	today = new Date()
): string[] {
	const digital =
		movie.expectedDigitalReleaseDate &&
		!isIsoDateOnOrBeforeToday(movie.expectedDigitalReleaseDate, today)
			? `Digital ${formatReleaseDate(movie.expectedDigitalReleaseDate)}${
					movie.expectedDigitalReleaseSource === 'estimated' ? ' (est.)' : ''
				}`
			: '';
	const hours = Math.floor(movie.runtime / 60);
	const minutes = movie.runtime % 60;
	const runtime = movie.runtime > 0 ? (hours ? `${hours}h ${minutes}m` : `${minutes}m`) : '';
	return [
		formatReleaseDate(movie.releaseDate),
		digital,
		runtime,
		ratingPart(movie.voteAverage, movie.voteCount),
	].filter(Boolean);
}

export function showMetaParts(show: {
	firstAirDate: string;
	lastAirDate: string;
	numberOfSeasons: number;
	numberOfEpisodes: number;
	status: string;
	voteAverage: number;
	voteCount: number;
}): string[] {
	const firstYear = show.firstAirDate.slice(0, 4);
	const lastYear = show.lastAirDate.slice(0, 4);
	const finished = show.status === 'Ended' || show.status === 'Canceled';
	const years = !firstYear
		? ''
		: !finished
			? `${firstYear}–`
			: !lastYear || lastYear === firstYear
				? firstYear
				: `${firstYear}–${lastYear}`;
	const seasons = show.numberOfSeasons
		? `${show.numberOfSeasons} season${show.numberOfSeasons === 1 ? '' : 's'}`
		: '';
	return [
		years,
		show.status === 'Returning Series' ? 'Returning' : show.status,
		seasons,
		show.numberOfEpisodes ? `${show.numberOfEpisodes} ep` : '',
		ratingPart(show.voteAverage, show.voteCount),
	].filter(Boolean);
}

// The year span hides the exact dates; keep them as a tooltip.
export function showAirDatesTitle(show: { firstAirDate: string; lastAirDate: string }): string {
	return [
		show.firstAirDate && `First aired ${formatReleaseDate(show.firstAirDate)}`,
		show.lastAirDate && `Last aired ${formatReleaseDate(show.lastAirDate)}`,
	]
		.filter(Boolean)
		.join(' · ');
}
