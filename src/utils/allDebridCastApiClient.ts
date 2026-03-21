import axios from 'axios';
import toast from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { groupBy } from './groupBy';
import { castToastOptions } from './toastOptions';

export const handleCastMovieAllDebrid = async (imdbId: string, apiKey: string, hash: string) => {
	try {
		const resp = await axios.get(
			`/api/stremio-ad/cast/movie/${imdbId}?apiKey=${apiKey}&hash=${hash}`
		);
		toast(`Casted ${resp.data.filename} to Stremio (AllDebrid).`, castToastOptions);
	} catch (error: any) {
		const errorMessage =
			error?.response?.data?.errorMessage ||
			(error instanceof Error ? error.message : 'Unknown error');
		console.error('Error casting movie (AllDebrid):', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
};

export const handleCastTvShowAllDebrid = async (
	imdbId: string,
	apiKey: string,
	hash: string,
	fileIndices: string[]
) => {
	const yetToCast = groupBy(5, fileIndices).map((batch) => async () => {
		try {
			const fIdxParam = batch.map((idx) => `fileIndices=${idx}`).join('&');
			const resp = await axios.get(
				`/api/stremio-ad/cast/series/${imdbId}?apiKey=${apiKey}&hash=${hash}&${fIdxParam}`
			);
			const errorEpisodes = resp.data.errorEpisodes;
			if (errorEpisodes.length) {
				toast.error(
					`Cast failed for ${errorEpisodes[0]}${
						errorEpisodes.length > 1 ? ` and ${errorEpisodes.length - 1} more` : ''
					} (AllDebrid).`,
					castToastOptions
				);
			} else {
				toast.success(
					`Casted ${batch.length} episode${batch.length === 1 ? '' : 's'} to Stremio (AllDebrid).`,
					castToastOptions
				);
			}
		} catch (error) {
			toast.error(
				`Failed to cast ${batch.length} episode${batch.length === 1 ? '' : 's'} (AllDebrid).`,
				castToastOptions
			);
		}
	});

	const [results] = await runConcurrentFunctions(yetToCast, 4, 0);
	if (results.length) {
		toast.success(`Finished casting all episodes to Stremio (AllDebrid).`, castToastOptions);
	}
};

export const saveAllDebridCastProfile = async (
	apiKey: string,
	movieMaxSize?: number,
	episodeMaxSize?: number,
	otherStreamsLimit?: number,
	hideCastOption?: boolean
) => {
	try {
		await axios.post(`/api/stremio-ad/cast/saveProfile`, {
			apiKey,
			...(movieMaxSize !== undefined && { movieMaxSize }),
			...(episodeMaxSize !== undefined && { episodeMaxSize }),
			...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
			...(hideCastOption !== undefined && { hideCastOption }),
		});
	} catch (error) {
		console.error('Error saving AllDebrid cast profile:', error);
	}
};

export const updateAllDebridSizeLimits = async (
	apiKey: string,
	movieMaxSize?: number,
	episodeMaxSize?: number,
	otherStreamsLimit?: number,
	hideCastOption?: boolean
) => {
	try {
		await axios.post(`/api/stremio-ad/cast/updateSizeLimits`, {
			apiKey,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption,
		});
	} catch (error) {
		console.error('Error updating AllDebrid size limits:', error);
	}
};

export const fetchAllDebridCastedLinks = async (apiKey: string) => {
	try {
		const resp = await axios.get(`/api/stremio-ad/links?apiKey=${apiKey}`);
		return resp.data.links || [];
	} catch (error) {
		console.error('Error fetching AllDebrid casted links:', error);
		return [];
	}
};

export const deleteAllDebridCastedLink = async (
	apiKey: string,
	imdbId: string,
	hash: string
): Promise<boolean> => {
	try {
		await axios.delete(`/api/stremio-ad/deletelink`, {
			data: { apiKey, imdbId, hash },
		});
		return true;
	} catch (error) {
		console.error('Error deleting AllDebrid casted link:', error);
		return false;
	}
};
