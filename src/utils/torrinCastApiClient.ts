import axios from 'axios';
import toast from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { groupBy } from './groupBy';
import { castToastOptions } from './toastOptions';

const creds = (baseUrl: string, apiKey: string) =>
	`baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`;

export const handleCastMovieTorrin = async (
	imdbId: string,
	baseUrl: string,
	apiKey: string,
	hash: string
) => {
	try {
		const resp = await axios.get(
			`/api/stremio-tr/cast/movie/${imdbId}?${creds(baseUrl, apiKey)}&hash=${hash}`
		);
		toast(`Casted ${resp.data.filename} to Stremio (Torrin).`, castToastOptions);
	} catch (error: any) {
		const errorMessage =
			error?.response?.data?.errorMessage ||
			(error instanceof Error ? error.message : 'Unknown error');
		console.error('Error casting movie (Torrin):', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
};

export const handleCastTvShowTorrin = async (
	imdbId: string,
	baseUrl: string,
	apiKey: string,
	hash: string,
	fileIds: string[]
) => {
	const yetToCast = groupBy(5, fileIds).map((batch) => async () => {
		try {
			const fIdParam = batch.map((id) => `fileIds=${id}`).join('&');
			const resp = await axios.get(
				`/api/stremio-tr/cast/series/${imdbId}?${creds(baseUrl, apiKey)}&hash=${hash}&${fIdParam}`
			);
			const errorEpisodes = resp.data.errorEpisodes ?? [];
			if (errorEpisodes.length) {
				toast.error(
					`Cast failed for ${errorEpisodes[0]}${
						errorEpisodes.length > 1 ? ` and ${errorEpisodes.length - 1} more` : ''
					} (Torrin).`,
					castToastOptions
				);
			} else {
				toast.success(
					`Casted ${batch.length} episode${batch.length === 1 ? '' : 's'} to Stremio (Torrin).`,
					castToastOptions
				);
			}
		} catch (error) {
			console.error('Error casting episodes (Torrin):', error);
			toast.error(
				`Failed to cast ${batch.length} episode${batch.length === 1 ? '' : 's'} (Torrin).`,
				castToastOptions
			);
		}
	});

	const [results] = await runConcurrentFunctions(yetToCast, 4, 0);
	if (results.length) {
		toast.success(`Finished casting all episodes to Stremio (Torrin).`, castToastOptions);
	}
};

export const saveTorrinCastProfile = async (
	baseUrl: string,
	apiKey: string,
	movieMaxSize?: number,
	episodeMaxSize?: number,
	otherStreamsLimit?: number,
	hideCastOption?: boolean
) => {
	try {
		await axios.post(`/api/stremio-tr/cast/saveProfile`, {
			baseUrl,
			apiKey,
			...(movieMaxSize !== undefined && { movieMaxSize }),
			...(episodeMaxSize !== undefined && { episodeMaxSize }),
			...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
			...(hideCastOption !== undefined && { hideCastOption }),
		});
	} catch (error) {
		console.error('Error saving Torrin cast profile:', error);
	}
};

export const updateTorrinSizeLimits = async (
	baseUrl: string,
	apiKey: string,
	movieMaxSize?: number,
	episodeMaxSize?: number,
	otherStreamsLimit?: number,
	hideCastOption?: boolean
) => {
	try {
		await axios.post(`/api/stremio-tr/cast/updateSizeLimits`, {
			baseUrl,
			apiKey,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption,
		});
	} catch (error) {
		console.error('Error updating Torrin size limits:', error);
	}
};

export const fetchTorrinCastedLinks = async (baseUrl: string, apiKey: string) => {
	try {
		const resp = await axios.get(`/api/stremio-tr/links?${creds(baseUrl, apiKey)}`);
		return resp.data.links || [];
	} catch (error) {
		console.error('Error fetching Torrin casted links:', error);
		return [];
	}
};

export const deleteTorrinCastedLink = async (
	baseUrl: string,
	apiKey: string,
	imdbId: string,
	hash: string
): Promise<boolean> => {
	try {
		await axios.delete(`/api/stremio-tr/deletelink`, {
			data: { baseUrl, apiKey, imdbId, hash },
		});
		return true;
	} catch (error) {
		console.error('Error deleting Torrin casted link:', error);
		return false;
	}
};
