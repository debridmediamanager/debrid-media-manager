import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import { defaultEpisodeSize, defaultMovieSize, defaultOtherStreamsLimit } from '@/utils/settings';
import { saveTorBoxCastProfile } from '@/utils/torboxCastApiClient';
import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import useLocalStorage from './localStorage';

interface UseTorBoxCastTokenOptions {
	/**
	 * Create the cast profile when there isn't one yet. Only the DMM Cast pages and
	 * /kodi should do this: the profile keeps the member's TorBox key on our server.
	 * Everywhere else the hook resyncs an existing profile and nothing more.
	 */
	enroll?: boolean;
}

export function useTorBoxCastToken({ enroll = false }: UseTorBoxCastTokenOptions = {}) {
	const [apiKey] = useLocalStorage<string>('tb:apiKey');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('tb:castToken');
	const hasEnsuredProfile = useRef(false);

	useEffect(() => {
		if (!apiKey) return;

		// Nothing to resync and not our place to enrol: stay off the network.
		if (!dmmCastToken && !enroll) return;

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
					} else {
						toast.error(`DMM Cast for TorBox: ${data.errorMessage ?? data.error}`);
					}
				}
			} catch (error) {
				toast.error('Failed to initialize DMM Cast for TorBox.');
			}
		};

		ensureProfileAndToken();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiKey, dmmCastToken, enroll]);

	return dmmCastToken;
}
