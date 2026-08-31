import { sponsorHeaders } from '@/hooks/useSponsor';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
	findVideoByName,
	pickBiggestVideo,
	prepareMagnetForCast,
} from './allDebridCastClientPipeline';
import { groupBy } from './groupBy';
import { castToastOptions } from './toastOptions';

export interface CastableAdFile {
	filename: string;
}

export const handleCastMovieAllDebrid = async (imdbId: string, apiKey: string, hash: string) => {
	try {
		const { magnetId, videoFiles } = await prepareMagnetForCast(apiKey, hash);
		const picked = pickBiggestVideo(videoFiles);
		await axios.post(`/api/stremio-ad/cast/movie/${imdbId}`, {
			apiKey,
			hash,
			magnetId,
			fileIndex: picked.fileIndex,
			streamUrl: picked.link,
			filename: picked.filename,
			fileSize: picked.fileSize,
		});
		toast(`Casted ${picked.filename} to Stremio (AllDebrid).`, castToastOptions);
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
	files: CastableAdFile[]
) => {
	// Prepare the magnet once; all requested files come from the same torrent.
	let magnetId: number;
	let videoFiles: Awaited<ReturnType<typeof prepareMagnetForCast>>['videoFiles'];
	try {
		const prepared = await prepareMagnetForCast(apiKey, hash);
		magnetId = prepared.magnetId;
		videoFiles = prepared.videoFiles;
	} catch (error: any) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		toast.error(`AllDebrid cast prep failed: ${message}`, castToastOptions);
		return;
	}

	const resolved = files
		.map((f) => findVideoByName(videoFiles, f.filename))
		.filter((f): f is NonNullable<typeof f> => f !== null);

	const missing = files.length - resolved.length;
	if (missing > 0) {
		toast.error(
			`${missing} episode file${missing === 1 ? '' : 's'} not found in magnet (AllDebrid).`,
			castToastOptions
		);
	}
	if (resolved.length === 0) return;

	const batches = groupBy(5, resolved).map((batch) => async () => {
		try {
			const resp = await axios.post(`/api/stremio-ad/cast/series/${imdbId}`, {
				apiKey,
				hash,
				magnetId,
				files: batch,
			});
			const errorEpisodes: string[] = resp.data?.errorEpisodes ?? [];
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

	for (const run of batches) await run();
	toast.success(`Finished casting all episodes to Stremio (AllDebrid).`, castToastOptions);
};

export interface AllDebridCastSettings {
	movieMaxSize?: number;
	episodeMaxSize?: number;
	otherStreamsLimit?: number;
	hideCastOption?: boolean;
}

const settingsBody = (settings: AllDebridCastSettings) => ({
	...(settings.movieMaxSize !== undefined && { movieMaxSize: settings.movieMaxSize }),
	...(settings.episodeMaxSize !== undefined && { episodeMaxSize: settings.episodeMaxSize }),
	...(settings.otherStreamsLimit !== undefined && {
		otherStreamsLimit: settings.otherStreamsLimit,
	}),
	...(settings.hideCastOption !== undefined && { hideCastOption: settings.hideCastOption }),
});

/**
 * Enrols the account in DMM Cast and returns its cast token.
 *
 * Costs one AllDebrid call, so only call this when the member is actually
 * opting into cast or has rotated their key — see syncAllDebridCastSettings
 * for the routine path.
 */
export const saveAllDebridCastProfile = async (
	apiKey: string,
	settings: AllDebridCastSettings = {}
): Promise<string | null> => {
	try {
		const resp = await axios.post(
			`/api/stremio-ad/cast/saveProfile`,
			{
				apiKey,
				...settingsBody(settings),
			},
			{ headers: sponsorHeaders() }
		);
		return resp.data?.profile?.userId ?? null;
	} catch (error) {
		console.error('Error saving AllDebrid cast profile:', error);
		return null;
	}
};

/**
 * Pushes cast settings using the token the client already holds, which needs no
 * AllDebrid call at all. Only a profile that has gone missing server-side (404)
 * falls back to the key, since nothing else can recreate it.
 */
export const syncAllDebridCastSettings = async (
	castToken: string | null | undefined,
	apiKey: string,
	settings: AllDebridCastSettings
): Promise<string | null> => {
	if (castToken) {
		try {
			await axios.post(
				`/api/stremio-ad/cast/updateSizeLimits`,
				{
					castToken,
					...settingsBody(settings),
				},
				{ headers: sponsorHeaders() }
			);
			return castToken;
		} catch (error: any) {
			if (error?.response?.status !== 404) {
				console.error('Error updating AllDebrid cast settings:', error);
				toast.error('Failed to save AllDebrid cast settings. Please try again.');
				return null;
			}
			// Profile is gone; recreating it from the key is the only way back.
		}
	}

	return saveAllDebridCastProfile(apiKey, settings);
};

export const fetchAllDebridCastedLinks = async (apiKey: string) => {
	try {
		const resp = await axios.post(`/api/stremio-ad/links`, { apiKey });
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
