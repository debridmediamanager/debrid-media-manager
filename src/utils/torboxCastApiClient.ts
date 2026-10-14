import { sponsorHeaders } from '@/hooks/useSponsor';
import axios from 'axios';
import toast from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { castErrorText } from './castApiClient';
import { groupBy } from './groupBy';
import { castToastOptions } from './toastOptions';

export const handleCastMovieTorBox = async (imdbId: string, apiKey: string, hash: string) => {
	try {
		// See castApiClient: the key belongs in the header, not the access logs.
		const resp = await axios.get(`/api/stremio-tb/cast/movie/${imdbId}?hash=${hash}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		toast(`Casted ${resp.data.filename} to Stremio (TorBox).`, castToastOptions);
	} catch (error: any) {
		const errorMessage = castErrorText(error);
		console.error('Error casting movie (TorBox):', errorMessage);
		// Rejecting is what lets the page's toast say why instead of "started".
		throw new Error(errorMessage);
	}
};

export const handleCastTvShowTorBox = async (
	imdbId: string,
	apiKey: string,
	hash: string,
	fileIds: string[]
) => {
	const failures = new Set<string>();
	const yetToCast = groupBy(5, fileIds).map((batch) => async () => {
		try {
			const fIdParam = batch.map((id) => `fileIds=${id}`).join('&');
			const resp = await axios.get(
				`/api/stremio-tb/cast/series/${imdbId}?hash=${hash}&${fIdParam}`,
				{ headers: { Authorization: `Bearer ${apiKey}` } }
			);
			const errorEpisodes: string[] = resp.data.errorEpisodes ?? [];
			if (errorEpisodes.length) {
				failures.add(
					`Cast failed for ${errorEpisodes[0]}${
						errorEpisodes.length > 1 ? ` and ${errorEpisodes.length - 1} more` : ''
					} (TorBox).`
				);
			} else {
				toast.success(
					`Casted ${batch.length} episode${batch.length === 1 ? '' : 's'} to Stremio (TorBox).`,
					castToastOptions
				);
			}
			return batch.length - errorEpisodes.length;
		} catch (error) {
			failures.add(
				`Failed to cast ${batch.length} episode${batch.length === 1 ? '' : 's'} (TorBox): ${castErrorText(error)}`
			);
			return 0;
		}
	});

	const [casted] = await runConcurrentFunctions(yetToCast, 4, 0);
	// Nothing cast is a failure, said with its reason, for the page's toast.
	if (!casted.some((n) => n > 0)) throw new Error([...failures].join(' ') || 'Nothing was cast.');
	failures.forEach((failure) => toast.error(failure, castToastOptions));
	toast.success(`Finished casting all episodes to Stremio (TorBox).`, castToastOptions);
};

export const saveTorBoxCastProfile = async (
	apiKey: string,
	movieMaxSize?: number,
	episodeMaxSize?: number,
	otherStreamsLimit?: number,
	hideCastOption?: boolean
) => {
	try {
		await axios.post(
			`/api/stremio-tb/cast/saveProfile`,
			{
				apiKey,
				...(movieMaxSize !== undefined && { movieMaxSize }),
				...(episodeMaxSize !== undefined && { episodeMaxSize }),
				...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
				...(hideCastOption !== undefined && { hideCastOption }),
			},
			{ headers: sponsorHeaders() }
		);
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
		await axios.post(
			`/api/stremio-tb/cast/updateSizeLimits`,
			{
				apiKey,
				movieMaxSize,
				episodeMaxSize,
				otherStreamsLimit,
				hideCastOption,
			},
			{ headers: sponsorHeaders() }
		);
	} catch (error) {
		console.error('Error updating TorBox size limits:', error);
		toast.error('Failed to save TorBox cast settings. Please try again.');
	}
};

export const fetchTorBoxCastedLinks = async (apiKey: string) => {
	try {
		const resp = await axios.get('/api/stremio-tb/links', {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
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
