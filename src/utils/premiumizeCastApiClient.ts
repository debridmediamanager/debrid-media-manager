import { sponsorHeaders } from '@/hooks/useSponsor';
import axios from 'axios';
import toast from 'react-hot-toast';
import { castToastOptions } from './toastOptions';

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

export const handleCastTvShowPremiumize = async (imdbId: string, apiKey: string, hash: string) => {
	// Only the hash goes over: Premiumize's cache probe returns no file listing,
	// so the browser has no episode filenames to send. The server resolves the
	// release with one `directdl` and casts every episode in it - which is also
	// one API call where naming the episodes cost one per batch.
	try {
		const resp = await axios.post(
			`/api/stremio-pm/cast/series/${imdbId}`,
			{ hash },
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
		}
		const casted: number = resp.data?.casted ?? 0;
		toast.success(
			`Casted ${casted} episode${casted === 1 ? '' : 's'} to Stremio (Premiumize).`,
			castToastOptions
		);
	} catch (error: any) {
		const errorMessage = errorTextOf(error);
		console.error('Error casting series (Premiumize):', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
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
		const resp = await axios.post(
			`/api/stremio-pm/cast/saveProfile`,
			{ apiKey, ...settings },
			{ headers: sponsorHeaders() }
		);
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
		await axios.post(
			`/api/stremio-pm/cast/updateSizeLimits`,
			{ userId, ...settings },
			{ headers: sponsorHeaders() }
		);
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
