import axios from 'axios';
import toast from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { groupBy } from './groupBy';
import { castToastOptions } from './toastOptions';

export const handleCastMovieTorBox = async (imdbId: string, apiKey: string, hash: string) => {
	try {
		const resp = await axios.get(
			`/api/stremio-tb/cast/movie/${imdbId}?apiKey=${apiKey}&hash=${hash}`
		);
		toast(`Casted ${resp.data.filename} to Stremio (TorBox).`, castToastOptions);
	} catch (error: any) {
		const errorMessage =
			error?.response?.data?.errorMessage ||
			(error instanceof Error ? error.message : 'Unknown error');
		console.error('Error casting movie (TorBox):', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
};

export const handleCastTvShowTorBox = async (
	imdbId: string,
	apiKey: string,
	hash: string,
	fileIds: string[]
) => {
	const yetToCast = groupBy(5, fileIds).map((batch) => async () => {
		try {
			const fIdParam = batch.map((id) => `fileIds=${id}`).join('&');
			const resp = await axios.get(
				`/api/stremio-tb/cast/series/${imdbId}?apiKey=${apiKey}&hash=${hash}&${fIdParam}`
			);
			const errorEpisodes = resp.data.errorEpisodes;
			if (errorEpisodes.length) {
				toast.error(
					`Cast failed for ${errorEpisodes[0]}${
						errorEpisodes.length > 1 ? ` and ${errorEpisodes.length - 1} more` : ''
					} (TorBox).`,
					castToastOptions
				);
			} else {
				toast.success(
					`Casted ${batch.length} episode${batch.length === 1 ? '' : 's'} to Stremio (TorBox).`,
					castToastOptions
				);
			}
		} catch (error) {
			toast.error(
				`Failed to cast ${batch.length} episode${batch.length === 1 ? '' : 's'} (TorBox).`,
				castToastOptions
			);
		}
	});

	const [results] = await runConcurrentFunctions(yetToCast, 4, 0);
	if (results.length) {
		toast.success(`Finished casting all episodes to Stremio (TorBox).`, castToastOptions);
	}
};

export const saveTorBoxCastProfile = async (
	apiKey: string,
	movieMaxSize?: number,
	episodeMaxSize?: number,
	otherStreamsLimit?: number,
	hideCastOption?: boolean
) => {
	try {
		await axios.post(`/api/stremio-tb/cast/saveProfile`, {
			apiKey,
			...(movieMaxSize !== undefined && { movieMaxSize }),
			...(episodeMaxSize !== undefined && { episodeMaxSize }),
			...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
			...(hideCastOption !== undefined && { hideCastOption }),
		});
	} catch (error) {
		console.error('Error saving TorBox cast profile:', error);
	}
};

export const updateTorBoxSizeLimits = async (
	apiKey: string,
	movieMaxSize?: number,
	episodeMaxSize?: number,
	otherStreamsLimit?: number,
	hideCastOption?: boolean
) => {
	try {
		await axios.post(`/api/stremio-tb/cast/updateSizeLimits`, {
			apiKey,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption,
		});
	} catch (error) {
		console.error('Error updating TorBox size limits:', error);
	}
};

export const fetchTorBoxCastedLinks = async (apiKey: string) => {
	try {
		const resp = await axios.get(`/api/stremio-tb/links?apiKey=${apiKey}`);
		return resp.data.links || [];
	} catch (error) {
		console.error('Error fetching TorBox casted links:', error);
		return [];
	}
};

export const deleteTorBoxCastedLink = async (
	apiKey: string,
	imdbId: string,
	hash: string
): Promise<boolean> => {
	try {
		await axios.delete(`/api/stremio-tb/deletelink`, {
			data: { apiKey, imdbId, hash },
		});
		return true;
	} catch (error) {
		console.error('Error deleting TorBox casted link:', error);
		return false;
	}
};
