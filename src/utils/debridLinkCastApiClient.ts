import { sponsorHeaders } from '@/hooks/useSponsor';
import axios from 'axios';
import toast from 'react-hot-toast';
import { castToastOptions } from './toastOptions';

const errorTextOf = (error: any) =>
	error?.response?.data?.errorMessage ||
	(error instanceof Error ? error.message : 'Unknown error');

export const handleCastMovieDebridLink = async (imdbId: string, token: string, hash: string) => {
	try {
		// The credential rides in the header, not the query string - see
		// castApiClient. Debrid-Link also accepts `?access_token=`, which is
		// exactly the log-leak path to keep away from.
		const resp = await axios.get(`/api/stremio-dl/cast/movie/${imdbId}?hash=${hash}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		toast(`Casted ${resp.data.filename} to Stremio (Debrid-Link).`, castToastOptions);
	} catch (error: any) {
		const errorMessage = errorTextOf(error);
		console.error('Error casting movie (Debrid-Link):', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
};

export const handleCastTvShowDebridLink = async (imdbId: string, token: string, hash: string) => {
	// Only the hash goes over. `POST /seedbox/add` answers with the release's
	// complete file list, so the server resolves the episodes in one call - and
	// the button must never be gated on a client-side file list, which is what
	// made Cast (PM) a movies-only button. Debrid-Link has no cache probe at
	// all, so the browser could not build that list even if it wanted to.
	try {
		const resp = await axios.post(
			`/api/stremio-dl/cast/series/${imdbId}`,
			{ hash },
			{ headers: { Authorization: `Bearer ${token}` } }
		);
		const errorEpisodes: string[] = resp.data?.errorEpisodes ?? [];
		if (errorEpisodes.length) {
			toast.error(
				`Cast failed for ${errorEpisodes[0]}${
					errorEpisodes.length > 1 ? ` and ${errorEpisodes.length - 1} more` : ''
				} (Debrid-Link).`,
				castToastOptions
			);
		}
		const casted: number = resp.data?.casted ?? 0;
		toast.success(
			`Casted ${casted} episode${casted === 1 ? '' : 's'} to Stremio (Debrid-Link).`,
			castToastOptions
		);
	} catch (error: any) {
		const errorMessage = errorTextOf(error);
		console.error('Error casting series (Debrid-Link):', errorMessage);
		toast.error(errorMessage, castToastOptions);
	}
};

export interface DebridLinkCastSettings {
	movieMaxSize?: number;
	episodeMaxSize?: number;
	otherStreamsLimit?: number;
	hideCastOption?: boolean;
}

export const saveDebridLinkCastProfile = async (
	token: string,
	settings: DebridLinkCastSettings = {},
	// Only a device-flow login has one. Sent when it exists so the server does
	// not need a second migration once Debrid-Link's real token lifetime is
	// measured; omitted otherwise, and omitting it never clears a stored one.
	refreshToken?: string | null
): Promise<string | null> => {
	try {
		const resp = await axios.post(
			`/api/stremio-dl/cast/saveProfile`,
			{ apiKey: token, ...(refreshToken ? { refreshToken } : {}), ...settings },
			{ headers: sponsorHeaders() }
		);
		return resp.data?.profile?.userId ?? null;
	} catch (error) {
		console.error('Error saving Debrid-Link cast profile:', errorTextOf(error));
		return null;
	}
};

export const updateDebridLinkCastSettings = async (
	userId: string,
	settings: DebridLinkCastSettings
): Promise<boolean> => {
	try {
		await axios.post(
			`/api/stremio-dl/cast/updateSizeLimits`,
			{ userId, ...settings },
			{ headers: sponsorHeaders() }
		);
		return true;
	} catch (error) {
		console.error('Error updating Debrid-Link cast settings:', errorTextOf(error));
		return false;
	}
};

export const fetchDebridLinkCastedLinks = async (token: string) => {
	try {
		const resp = await axios.post(`/api/stremio-dl/links`, { apiKey: token });
		return resp.data.links || [];
	} catch (error) {
		console.error('Error fetching Debrid-Link casted links:', errorTextOf(error));
		return [];
	}
};

export const deleteDebridLinkCastedLink = async (
	token: string,
	imdbId: string,
	hash: string
): Promise<boolean> => {
	try {
		await axios.delete(`/api/stremio-dl/deletelink`, { data: { apiKey: token, imdbId, hash } });
		return true;
	} catch (error) {
		console.error('Error deleting Debrid-Link casted link:', errorTextOf(error));
		return false;
	}
};
