import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import { defaultEpisodeSize, defaultMovieSize, defaultOtherStreamsLimit } from '@/utils/settings';
import { saveTorBoxCastProfile } from '@/utils/torboxCastApiClient';
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import useLocalStorage from './localStorage';

export function useTorBoxCastToken() {
	const [apiKey] = useLocalStorage<string>('tb:apiKey');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('tb:castToken');

	useEffect(() => {
		// Only run if we have an API key but no token
		if (!apiKey) return;
		if (dmmCastToken) return;

		const fetchToken = async () => {
			try {
				const res = await fetch('/api/stremio-tb/id?apiKey=' + apiKey);
				const data = await res.json();
				if (data.status !== 'error' && data.id) {
					// Save profile with settings to backend
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
					await saveTorBoxCastProfile(
						apiKey,
						movieMaxSize,
						episodeMaxSize,
						otherStreamsLimit,
						hideCastOption
					);
					setDmmCastToken(data.id);
				}
			} catch (error) {
				toast.error('Failed to fetch DMM Cast TorBox token.');
			}
		};

		fetchToken();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiKey, dmmCastToken]);

	return dmmCastToken;
}
