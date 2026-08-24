import axios from 'axios';
import toast from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { groupBy } from './groupBy';
import { castToastOptions } from './toastOptions';

export const handleCastMovie = async (imdbId: string, rdKey: string, hash: string) => {
	try {
		// The key goes in the header, not the query string: a query parameter is
		// written verbatim into every access log on the way, and an RD apitoken
		// never expires.
		const resp = await axios.get(`/api/stremio/cast/movie/${imdbId}?hash=${hash}`, {
			headers: { Authorization: `Bearer ${rdKey}` },
		});
		toast(`Casted ${resp.data.filename} to Stremio.`, castToastOptions);
	} catch (error: any) {
		const errorMessage =
			error?.response?.data?.errorMessage ||
			(error instanceof Error ? error.message : 'Unknown error');
		console.error('Error casting movie:', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
};

export const handleCastTvShow = async (
	imdbId: string,
	rdKey: string,
	hash: string,
	fileIds: string[]
) => {
	const yetToCast = groupBy(5, fileIds).map((batch) => async () => {
		try {
			const fIdParam = batch.map((id) => `fileIds=${id}`).join('&');
			const resp = await axios.get(
				`/api/stremio/cast/series/${imdbId}?hash=${hash}&${fIdParam}`,
				{ headers: { Authorization: `Bearer ${rdKey}` } }
			);
			const errorEpisodes = resp.data.errorEpisodes;
			if (errorEpisodes.length) {
				toast.error(
					`Cast failed for ${errorEpisodes[0]}${
						errorEpisodes.length > 1 ? ` and ${errorEpisodes.length - 1} more` : ''
					}.`,
					castToastOptions
				);
			} else {
				toast.success(
					`Casted ${batch.length} episode${batch.length === 1 ? '' : 's'} to Stremio.`,
					castToastOptions
				);
			}
		} catch (error) {
			toast.error(
				`Failed to cast ${batch.length} episode${batch.length === 1 ? '' : 's'}.`,
				castToastOptions
			);
		}
	});

	const [results] = await runConcurrentFunctions(yetToCast, 4, 0);
	if (results.length) {
		toast.success(`Finished casting all episodes to Stremio.`, castToastOptions);
	}
};

export const saveCastProfile = async (
	clientId: string,
	clientSecret: string,
	refreshToken: string,
	movieMaxSize?: number,
	episodeMaxSize?: number,
	otherStreamsLimit?: number,
	hideCastOption?: boolean
) => {
	try {
		await axios.post(`/api/stremio/cast/saveProfile`, {
			clientId,
			clientSecret,
			refreshToken,
			...(movieMaxSize !== undefined && { movieMaxSize }),
			...(episodeMaxSize !== undefined && { episodeMaxSize }),
			...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
			...(hideCastOption !== undefined && { hideCastOption }),
		});
	} catch (error) {}
};
