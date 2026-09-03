import { sponsorHeaders } from '@/hooks/useSponsor';
import axios from 'axios';
import toast from 'react-hot-toast';
import { castToastOptions } from './toastOptions';

const errorTextOf = (error: any) =>
	error?.response?.data?.errorMessage ||
	(error instanceof Error ? error.message : 'Unknown error');

export const handleCastMovieOffcloud = async (imdbId: string, apiKey: string, hash: string) => {
	try {
		// The key rides in the header, not the query string - see castApiClient.
		const resp = await axios.get(`/api/stremio-oc/cast/movie/${imdbId}?hash=${hash}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		toast(`Casted ${resp.data.filename} to Stremio (Offcloud).`, castToastOptions);
	} catch (error: any) {
		const errorMessage = errorTextOf(error);
		console.error('Error casting movie (Offcloud):', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
};

export const handleCastTvShowOffcloud = async (imdbId: string, apiKey: string, hash: string) => {
	// Only the hash goes over. Offcloud's `cache/info` resolves a magnet to its
	// complete file listing without adding anything to the account, so the
	// server does the episode resolution in one stateless call - and the button
	// must never be gated on a client-side file list, which is what made Cast
	// (PM) a movies-only button.
	try {
		const resp = await axios.post(
			`/api/stremio-oc/cast/series/${imdbId}`,
			{ hash },
			{ headers: { Authorization: `Bearer ${apiKey}` } }
		);
		const errorEpisodes: string[] = resp.data?.errorEpisodes ?? [];
		if (errorEpisodes.length) {
			toast.error(
				`Cast failed for ${errorEpisodes[0]}${
					errorEpisodes.length > 1 ? ` and ${errorEpisodes.length - 1} more` : ''
				} (Offcloud).`,
				castToastOptions
			);
		}
		const casted: number = resp.data?.casted ?? 0;
		toast.success(
			`Casted ${casted} episode${casted === 1 ? '' : 's'} to Stremio (Offcloud).`,
			castToastOptions
		);
	} catch (error: any) {
		const errorMessage = errorTextOf(error);
		console.error('Error casting series (Offcloud):', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
};

export interface OffcloudCastSettings {
	movieMaxSize?: number;
	episodeMaxSize?: number;
	otherStreamsLimit?: number;
	hideCastOption?: boolean;
}

export const saveOffcloudCastProfile = async (
	apiKey: string,
	settings: OffcloudCastSettings = {}
): Promise<string | null> => {
	try {
		const resp = await axios.post(
			`/api/stremio-oc/cast/saveProfile`,
			{ apiKey, ...settings },
			{ headers: sponsorHeaders() }
		);
		return resp.data?.profile?.userId ?? null;
	} catch (error) {
		console.error('Error saving Offcloud cast profile:', errorTextOf(error));
		return null;
	}
};

export const updateOffcloudCastSettings = async (
	userId: string,
	settings: OffcloudCastSettings
): Promise<boolean> => {
	try {
		await axios.post(
			`/api/stremio-oc/cast/updateSizeLimits`,
			{ userId, ...settings },
			{ headers: sponsorHeaders() }
		);
		return true;
	} catch (error) {
		console.error('Error updating Offcloud cast settings:', errorTextOf(error));
		return false;
	}
};

export const fetchOffcloudCastedLinks = async (apiKey: string) => {
	try {
		const resp = await axios.post(`/api/stremio-oc/links`, { apiKey });
		return resp.data.links || [];
	} catch (error) {
		console.error('Error fetching Offcloud casted links:', errorTextOf(error));
		return [];
	}
};

export const deleteOffcloudCastedLink = async (
	apiKey: string,
	imdbId: string,
	hash: string
): Promise<boolean> => {
	try {
		await axios.delete(`/api/stremio-oc/deletelink`, { data: { apiKey, imdbId, hash } });
		return true;
	} catch (error) {
		console.error('Error deleting Offcloud casted link:', errorTextOf(error));
		return false;
	}
};
