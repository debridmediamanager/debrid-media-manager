import { sponsorHeaders } from '@/hooks/useSponsor';
import axios from 'axios';
import toast from 'react-hot-toast';
import { castToastOptions } from './toastOptions';

const errorTextOf = (error: any) =>
	error?.response?.data?.errorMessage ||
	(error instanceof Error ? error.message : 'Unknown error');

/**
 * Casts one Easynews result. `kind` picks the key the server files it under: the
 * film's IMDb id, or the episode its name carries. The key rides in the header,
 * not the query string - see castApiClient.
 */
export const handleCastEasynews = async (
	kind: 'movie' | 'show',
	imdbId: string,
	apiKey: string,
	result: { path: string; size: number }
): Promise<{ filename: string; key: string }> => {
	try {
		const resp = await axios.post(
			`/api/stremio-en/cast/${kind === 'movie' ? 'movie' : 'series'}/${imdbId}`,
			{ path: result.path, size: result.size },
			{ headers: { Authorization: `Bearer ${apiKey}` } }
		);
		toast(`Casted ${resp.data.filename} to Stremio (Easynews).`, castToastOptions);
		return { filename: resp.data.filename, key: resp.data.key };
	} catch (error: any) {
		const errorMessage = errorTextOf(error);
		console.error('Error casting (Easynews):', errorMessage);
		// Rejecting is what lets the page's toast say why instead of "started".
		throw new Error(errorMessage);
	}
};

export interface EasynewsCastSettings {
	movieMaxSize?: number;
	episodeMaxSize?: number;
	otherStreamsLimit?: number;
	hideCastOption?: boolean;
}

export const saveEasynewsCastProfile = async (
	apiKey: string,
	settings: EasynewsCastSettings = {}
): Promise<string | null> => {
	try {
		const resp = await axios.post(
			`/api/stremio-en/cast/saveProfile`,
			{ apiKey, ...settings },
			{ headers: sponsorHeaders() }
		);
		return resp.data?.profile?.userId ?? null;
	} catch (error) {
		console.error('Error saving Easynews cast profile:', errorTextOf(error));
		return null;
	}
};

export const updateEasynewsCastSettings = async (
	userId: string,
	settings: EasynewsCastSettings
): Promise<boolean> => {
	try {
		await axios.post(
			`/api/stremio-en/cast/updateSizeLimits`,
			{ userId, ...settings },
			{ headers: sponsorHeaders() }
		);
		return true;
	} catch (error) {
		console.error('Error updating Easynews cast settings:', errorTextOf(error));
		return false;
	}
};

export const fetchEasynewsCastedLinks = async (apiKey: string) => {
	try {
		const resp = await axios.post(`/api/stremio-en/links`, { apiKey });
		return resp.data.links || [];
	} catch (error) {
		console.error('Error fetching Easynews casted links:', errorTextOf(error));
		return [];
	}
};

export const deleteEasynewsCastedLink = async (
	apiKey: string,
	imdbId: string,
	hash: string
): Promise<boolean> => {
	try {
		await axios.delete(`/api/stremio-en/deletelink`, { data: { apiKey, imdbId, hash } });
		return true;
	} catch (error) {
		console.error('Error deleting Easynews casted link:', errorTextOf(error));
		return false;
	}
};
