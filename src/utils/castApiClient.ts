import axios from 'axios';
import toast from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { groupBy } from './groupBy';
import { castToastOptions } from './toastOptions';

export const handleCastMovie = async (
	castToken: string,
	imdbId: string,
	rdKey: string,
	hash: string
) => {
	try {
		const resp = await axios.get(
			`/api/stremio/${castToken}/cast/movie/${imdbId}?token=${rdKey}&hash=${hash}`
		);
		toast(`Successfully casted movie ${resp.data.filename}`, castToastOptions);
	} catch (error) {
		console.error(error);
		toast.error('There was an error casting the movie');
	}
};

export const handleCastTvShow = async (
	castToken: string,
	imdbId: string,
	rdKey: string,
	hash: string,
	fileIds: string[]
) => {
	const yetToCast = groupBy(5, fileIds).map((batch) => async () => {
		try {
			const fIdParam = batch.map((id) => `fileIds=${id}`).join('&');
			const resp = await axios.get(
				`/api/stremio/${castToken}/cast/series/${imdbId}?token=${rdKey}&hash=${hash}&${fIdParam}`
			);
			const errorEpisodes = resp.data.errorEpisodes;
			if (errorEpisodes.length) {
				toast.error(
					`Error casting ${errorEpisodes[0]}${
						errorEpisodes.length > 1
							? ` and ${errorEpisodes.length - 1} other episodes`
							: ''
					}`,
					castToastOptions
				);
			} else {
				toast.success(`Successfully casted ${batch.length} episodes`, castToastOptions);
			}
		} catch (error) {
			toast.error(`Error casting ${batch.length} episodes`, castToastOptions);
		}
	});

	const [results] = await runConcurrentFunctions(yetToCast, 4, 0);
	if (results.length) {
		toast.success(`Finished casting all episodes in TV series torrent`, castToastOptions);
	}
};

export const handleCastAnime = async (
	castToken: string,
	anidbId: string,
	rdKey: string,
	hash: string,
	fileIds: string[]
) => {
	const yetToCast = groupBy(5, fileIds).map((batch) => async () => {
		try {
			const fIdParam = batch.map((id) => `fileIds=${id}`).join('&');
			const resp = await axios.get(
				`/api/stremio/${castToken}/cast/anime/${anidbId}?token=${rdKey}&hash=${hash}&${fIdParam}`
			);
			const errorEpisodes = resp.data.errorEpisodes;
			if (errorEpisodes.length) {
				toast.error(
					`Error casting ${errorEpisodes[0]}${
						errorEpisodes.length > 1
							? ` and ${errorEpisodes.length - 1} other episodes`
							: ''
					}`,
					castToastOptions
				);
			} else {
				toast.success(`Successfully casted ${batch.length} episodes`, castToastOptions);
			}
		} catch (error) {
			toast.error(`Error casting ${batch.length} episodes`, castToastOptions);
		}
	});

	const [results] = await runConcurrentFunctions(yetToCast, 4, 0);
	if (results.length) {
		toast.success(`Finished casting all episodes in anime series torrent`, castToastOptions);
	}
};
