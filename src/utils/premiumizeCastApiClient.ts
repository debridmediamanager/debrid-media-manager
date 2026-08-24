import axios from 'axios';
import toast from 'react-hot-toast';
import { groupBy } from './groupBy';
import { castToastOptions } from './toastOptions';

export interface CastablePmFile {
	filename: string;
}

const errorTextOf = (error: any) =>
	error?.response?.data?.errorMessage ||
	(error instanceof Error ? error.message : 'Unknown error');

export const handleCastMoviePremiumize = async (imdbId: string, apiKey: string, hash: string) => {
	try {
		// The key rides in the header, not the query string - see castApiClient.
		const resp = await axios.get(`/api/stremio-pm/cast/movie/${imdbId}?hash=${hash}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		toast(`Casted ${resp.data.filename} to Stremio (Premiumize).`, castToastOptions);
	} catch (error: any) {
		const errorMessage = errorTextOf(error);
		console.error('Error casting movie (Premiumize):', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
};

export const handleCastTvShowPremiumize = async (
	imdbId: string,
	apiKey: string,
	hash: string,
	files: CastablePmFile[]
) => {
	// Premiumize has no per-file id, so episodes are addressed by filename. That
	// is also the only addressing that cannot drift: a positional index is what
	// makes the other providers cast the wrong episode.
	const batches = groupBy(5, files).map((batch) => async () => {
		try {
			const resp = await axios.post(
				`/api/stremio-pm/cast/series/${imdbId}`,
				{ hash, filenames: batch.map((f) => f.filename) },
				{ headers: { Authorization: `Bearer ${apiKey}` } }
			);
			const errorEpisodes: string[] = resp.data?.errorEpisodes ?? [];
			if (errorEpisodes.length) {
				toast.error(
					`Cast failed for ${errorEpisodes[0]}${
						errorEpisodes.length > 1 ? ` and ${errorEpisodes.length - 1} more` : ''
					} (Premiumize).`,
					castToastOptions
				);
			} else {
				toast.success(
					`Casted ${batch.length} episode${batch.length === 1 ? '' : 's'} to Stremio (Premiumize).`,
					castToastOptions
				);
			}
		} catch (error) {
			toast.error(
				`Failed to cast ${batch.length} episode${batch.length === 1 ? '' : 's'} (Premiumize).`,
				castToastOptions
			);
		}
	});

	for (const run of batches) await run();
	toast.success(`Finished casting all episodes to Stremio (Premiumize).`, castToastOptions);
};

export interface PremiumizeCastSettings {
	movieMaxSize?: number;
	episodeMaxSize?: number;
	otherStreamsLimit?: number;
	hideCastOption?: boolean;
}

export const savePremiumizeCastProfile = async (
	apiKey: string,
	settings: PremiumizeCastSettings = {}
): Promise<string | null> => {
	try {
		const resp = await axios.post(`/api/stremio-pm/cast/saveProfile`, { apiKey, ...settings });
		return resp.data?.profile?.userId ?? null;
	} catch (error) {
		console.error('Error saving Premiumize cast profile:', errorTextOf(error));
		return null;
	}
};

export const updatePremiumizeCastSettings = async (
	userId: string,
	settings: PremiumizeCastSettings
): Promise<boolean> => {
	try {
		await axios.post(`/api/stremio-pm/cast/updateSizeLimits`, { userId, ...settings });
		return true;
	} catch (error) {
		console.error('Error updating Premiumize cast settings:', errorTextOf(error));
		return false;
	}
};

export const fetchPremiumizeCastedLinks = async (apiKey: string) => {
	try {
		const resp = await axios.post(`/api/stremio-pm/links`, { apiKey });
		return resp.data.links || [];
	} catch (error) {
		console.error('Error fetching Premiumize casted links:', errorTextOf(error));
		return [];
	}
};

export const deletePremiumizeCastedLink = async (
	apiKey: string,
	imdbId: string,
	hash: string
): Promise<boolean> => {
	try {
		await axios.delete(`/api/stremio-pm/deletelink`, { data: { apiKey, imdbId, hash } });
		return true;
	} catch (error) {
		console.error('Error deleting Premiumize casted link:', errorTextOf(error));
		return false;
	}
};
