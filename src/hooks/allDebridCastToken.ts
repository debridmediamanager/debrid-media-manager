import { saveAllDebridCastProfile } from '@/utils/allDebridCastApiClient';
import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import { defaultEpisodeSize, defaultMovieSize, defaultOtherStreamsLimit } from '@/utils/settings';
import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import useLocalStorage from './localStorage';

export function useAllDebridCastToken() {
	const [apiKey] = useLocalStorage<string>('ad:apiKey');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('ad:castToken');
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
					await saveAllDebridCastProfile(
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
					const res = await fetch('/api/stremio-ad/id?apiKey=' + apiKey);
					const data = await res.json();
					if (data.status !== 'error' && data.id) {
						setDmmCastToken(data.id);
					}
				}
			} catch (error) {
				toast.error('Failed to initialize DMM Cast for AllDebrid.');
			}
		};

		ensureProfileAndToken();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiKey, dmmCastToken]);

	return dmmCastToken;
}
