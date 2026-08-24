import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import {
	savePremiumizeCastProfile,
	updatePremiumizeCastSettings,
} from '@/utils/premiumizeCastApiClient';
import { defaultEpisodeSize, defaultMovieSize, defaultOtherStreamsLimit } from '@/utils/settings';
import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { usePremiumizeCredential } from './auth';
import useLocalStorage from './localStorage';

interface UsePremiumizeCastTokenOptions {
	/**
	 * Create the cast profile when there isn't one yet. Only the DMM Cast page
	 * should do this: enrolling costs a Premiumize call with the member's key.
	 * Everywhere else the hook resyncs an existing profile and nothing more.
	 */
	enroll?: boolean;
}

export function usePremiumizeCastToken({ enroll = false }: UsePremiumizeCastTokenOptions = {}) {
	const apiKey = usePremiumizeCredential();
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('pm:castToken');
	// The key the stored profile was last written with. Lets us tell "settings
	// drifted" (free to fix) from "the member rotated their key" (needs a call).
	const [syncedApiKey, setSyncedApiKey] = useLocalStorage<string>('pm:castSyncedKey');
	const inFlight = useRef(false);
	// Key we have already synced on this mount. Writing the two localStorage
	// values below re-runs this effect, and without this it would sync twice.
	const doneForKey = useRef<string | null>(null);

	useEffect(() => {
		if (!apiKey) return;

		// Nothing to resync and not our place to enrol: stay off the network
		// entirely, which is the case for the vast majority of page views.
		if (!dmmCastToken && !enroll) return;

		if (inFlight.current || doneForKey.current === apiKey) return;
		inFlight.current = true;

		const sync = async () => {
			try {
				const settings = {
					movieMaxSize: Number(
						getLocalStorageItemOrDefault('settings:movieMaxSize', defaultMovieSize)
					),
					episodeMaxSize: Number(
						getLocalStorageItemOrDefault('settings:episodeMaxSize', defaultEpisodeSize)
					),
					otherStreamsLimit: Number(
						getLocalStorageItemOrDefault(
							'settings:otherStreamsLimit',
							defaultOtherStreamsLimit
						)
					),
					hideCastOption: getLocalStorageBoolean('settings:hideCastOption', false),
				};

				// A key we have never synced has to go through the full save so the
				// server stores the current one; otherwise the addon would keep
				// streaming against a key the member has already replaced.
				const keyIsCurrent = !!dmmCastToken && syncedApiKey === apiKey;

				let token: string | null = dmmCastToken ?? null;
				if (keyIsCurrent) {
					const ok = await updatePremiumizeCastSettings(dmmCastToken, settings);
					if (!ok) token = await savePremiumizeCastProfile(apiKey, settings);
				} else {
					token = await savePremiumizeCastProfile(apiKey, settings);
				}

				// Left unset on failure so a later render can retry.
				if (!token) return;
				doneForKey.current = apiKey;

				if (token !== dmmCastToken) setDmmCastToken(token);
				if (apiKey !== syncedApiKey) setSyncedApiKey(apiKey);
			} catch (error) {
				toast.error('Failed to initialize DMM Cast for Premiumize.');
			} finally {
				inFlight.current = false;
			}
		};

		sync();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiKey, dmmCastToken, syncedApiKey, enroll]);

	return dmmCastToken;
}
