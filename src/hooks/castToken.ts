import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import { saveCastProfile, type RdCastCredentialsInput } from '@/utils/castApiClient';
import { isLegacyToken } from '@/utils/castApiHelpers';
import { defaultEpisodeSize, defaultMovieSize, defaultOtherStreamsLimit } from '@/utils/settings';
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import useLocalStorage from './localStorage';

export function useCastToken() {
	const [clientId] = useLocalStorage<string>('rd:clientId');
	const [clientSecret] = useLocalStorage<string>('rd:clientSecret');
	const [refreshToken] = useLocalStorage<string>('rd:refreshToken');
	const [accessToken] = useLocalStorage<string>('rd:accessToken');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('rd:castToken');

	// The device-code login stores the triple; a pasted API key stores only the
	// access token. Both are complete Real-Debrid sessions, so both get a cast
	// profile - `credentials` is null only when there is no session at all.
	const credentials: RdCastCredentialsInput | null =
		clientId && clientSecret && refreshToken
			? { clientId, clientSecret, refreshToken }
			: accessToken
				? { apiKey: accessToken }
				: null;

	// Always sync credentials and settings to server when they change
	useEffect(() => {
		if (!credentials) return;
		const movieMaxSize = Number(
			getLocalStorageItemOrDefault('settings:movieMaxSize', defaultMovieSize)
		);
		const episodeMaxSize = Number(
			getLocalStorageItemOrDefault('settings:episodeMaxSize', defaultEpisodeSize)
		);
		const otherStreamsLimit = Number(
			getLocalStorageItemOrDefault('settings:otherStreamsLimit', defaultOtherStreamsLimit)
		);
		const hideCastOption = getLocalStorageBoolean('settings:hideCastOption', false);
		saveCastProfile(
			credentials,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clientId, clientSecret, refreshToken, accessToken]);

	useEffect(() => {
		// Only run if we don't have a token but have a Real-Debrid session
		if (!accessToken) return;

		// If we have a legacy 5-character token, clear it to trigger regeneration
		if (dmmCastToken && isLegacyToken(dmmCastToken)) {
			setDmmCastToken(''); // Clear the legacy token
			return; // Let the next render cycle handle regeneration
		}

		if (dmmCastToken) return;

		const fetchToken = async () => {
			try {
				// Header, not `?token=`: an API key never expires, and a query
				// parameter is written verbatim into every access log on the
				// way. `extractToken` reads the Bearer header first.
				const res = await fetch('/api/stremio/id', {
					headers: { Authorization: `Bearer ${accessToken}` },
				});
				const data = await res.json();
				if (data.status !== 'error') {
					setDmmCastToken(data.id);
				}
			} catch (error) {
				toast.error('Failed to fetch DMM Cast token.');
			}
		};

		fetchToken();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [accessToken, clientId, clientSecret, refreshToken, dmmCastToken]);

	return dmmCastToken;
}
