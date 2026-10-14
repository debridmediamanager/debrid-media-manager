import { sponsorHeaders } from '@/hooks/useSponsor';
import axios from 'axios';
import toast from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { groupBy } from './groupBy';
import { castToastOptions } from './toastOptions';

/** The server's reason for a failed cast request, else the request's own error. */
export const castErrorText = (error: any): string =>
	error?.response?.data?.errorMessage ||
	(error instanceof Error ? error.message : 'Unknown error');

export const handleCastMovie = async (imdbId: string, rdKey: string, hash: string) => {
	try {
		// The key goes in the header, not the query string: a query parameter is
		// written verbatim into every access log on the way, and an RD apitoken
		// never expires.
		const resp = await axios.get(`/api/stremio/cast/movie/${imdbId}?hash=${hash}`, {
			headers: { Authorization: `Bearer ${rdKey}` },
		});
		toast(`Casted ${resp.data.filename} to Stremio.`, castToastOptions);
	} catch (error: any) {
		const errorMessage = castErrorText(error);
		console.error('Error casting movie:', errorMessage);
		// Rejecting is what lets the page's toast say why instead of "started".
		throw new Error(errorMessage);
	}
};

export const handleCastTvShow = async (
	imdbId: string,
	rdKey: string,
	hash: string,
	fileIds: string[]
) => {
	const failures = new Set<string>();
	const yetToCast = groupBy(5, fileIds).map((batch) => async () => {
		try {
			const fIdParam = batch.map((id) => `fileIds=${id}`).join('&');
			const resp = await axios.get(
				`/api/stremio/cast/series/${imdbId}?hash=${hash}&${fIdParam}`,
				{ headers: { Authorization: `Bearer ${rdKey}` } }
			);
			const errorEpisodes: string[] = resp.data.errorEpisodes ?? [];
			if (resp.data.errorMessage) {
				// Real-Debrid refused the add twice: the reason, not a file id.
				failures.add(resp.data.errorMessage);
			} else if (errorEpisodes.length) {
				failures.add(
					`Cast failed for ${errorEpisodes[0]}${
						errorEpisodes.length > 1 ? ` and ${errorEpisodes.length - 1} more` : ''
					}.`
				);
			} else {
				toast.success(
					`Casted ${batch.length} episode${batch.length === 1 ? '' : 's'} to Stremio.`,
					castToastOptions
				);
			}
			return batch.length - errorEpisodes.length;
		} catch (error) {
			failures.add(
				`Failed to cast ${batch.length} episode${batch.length === 1 ? '' : 's'}: ${castErrorText(error)}`
			);
			return 0;
		}
	});

	const [casted] = await runConcurrentFunctions(yetToCast, 4, 0);
	// Nothing cast is a failure, said with its reason, for the page's toast.
	if (!casted.some((n) => n > 0)) throw new Error([...failures].join(' ') || 'Nothing was cast.');
	failures.forEach((failure) => toast.error(failure, castToastOptions));
	toast.success(`Finished casting all episodes to Stremio.`, castToastOptions);
};

/**
 * Either the OAuth triple or a pasted API key - `/realdebrid/login` stores one
 * or the other, never both.
 */
export type RdCastCredentialsInput =
	| { clientId: string; clientSecret: string; refreshToken: string }
	| { apiKey: string };

export const saveCastProfile = async (
	credentials: RdCastCredentialsInput,
	movieMaxSize?: number,
	episodeMaxSize?: number,
	otherStreamsLimit?: number,
	hideCastOption?: boolean
) => {
	try {
		await axios.post(
			`/api/stremio/cast/saveProfile`,
			{
				...credentials,
				...(movieMaxSize !== undefined && { movieMaxSize }),
				...(episodeMaxSize !== undefined && { episodeMaxSize }),
				...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
				...(hideCastOption !== undefined && { hideCastOption }),
			},
			{ headers: sponsorHeaders() }
		);
	} catch (error) {}
};
