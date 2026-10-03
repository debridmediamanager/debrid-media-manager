import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import { defaultEpisodeSize, defaultMovieSize, defaultOtherStreamsLimit } from '@/utils/settings';
import { saveTorBoxCastProfile } from '@/utils/torboxCastApiClient';
import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import useLocalStorage from './localStorage';

export function useTorBoxCastToken() {
	const [apiKey] = useLocalStorage<string>('tb:apiKey');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('tb:castToken');
	const hasEnsuredProfile = useRef(false);

	useEffect(() => {
		if (!apiKey) return;

		const ensureProfileAndToken = async () => {
			try {
				// Always try to save profile with settings to ensure it exists in database
				if (!hasEnsuredProfile.current) {
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
					hasEnsuredProfile.current = true;
				}

				// Fetch token if we don't have one
				if (!dmmCastToken) {
					// Header, not `?apiKey=`: a query parameter is written
					// verbatim into every access log on the way.
					const res = await fetch('/api/stremio-tb/id', {
						headers: { Authorization: `Bearer ${apiKey}` },
					});
					const data = await res.json();
					if (data.status !== 'error' && data.id) {
						setDmmCastToken(data.id);
					}
				}
			} catch (error) {
				toast.error('Failed to initialize DMM Cast for TorBox.');
			}
		};

		ensureProfileAndToken();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiKey, dmmCastToken]);

	return dmmCastToken;
}
