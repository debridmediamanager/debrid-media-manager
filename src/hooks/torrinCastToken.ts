import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import { defaultEpisodeSize, defaultMovieSize, defaultOtherStreamsLimit } from '@/utils/settings';
import { saveTorrinCastProfile } from '@/utils/torrinCastApiClient';
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import useLocalStorage from './localStorage';

export function useTorrinCastToken() {
	const [baseUrl] = useLocalStorage<string>('torrin:baseUrl');
	const [apiKey] = useLocalStorage<string>('torrin:apiKey');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('torrin:castToken');

	useEffect(() => {
		if (!baseUrl || !apiKey) return;
		if (dmmCastToken) return;

		const fetchToken = async () => {
			try {
				const res = await fetch(
					`/api/stremio-tr/id?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`
				);
				const data = await res.json();
				if (data.status !== 'error' && data.id) {
					const movieMaxSize = Number(
						getLocalStorageItemOrDefault('settings:movieMaxSize', defaultMovieSize)
					);
					const episodeMaxSize = Number(
						getLocalStorageItemOrDefault('settings:episodeMaxSize', defaultEpisodeSize)
					);
					const otherStreamsLimit = Number(
						getLocalStorageItemOrDefault(
							'settings:otherStreamsLimit',
							defaultOtherStreamsLimit
						)
					);
					const hideCastOption = getLocalStorageBoolean('settings:hideCastOption', false);
					await saveTorrinCastProfile(
						baseUrl,
						apiKey,
						movieMaxSize,
						episodeMaxSize,
						otherStreamsLimit,
						hideCastOption
					);
					setDmmCastToken(data.id);
				}
			} catch (error) {
				toast.error('Failed to fetch DMM Cast Torrin token.');
			}
		};

		fetchToken();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [baseUrl, apiKey, dmmCastToken]);

	return dmmCastToken;
}
