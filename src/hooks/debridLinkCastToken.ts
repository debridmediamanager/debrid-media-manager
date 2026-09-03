import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import {
	saveDebridLinkCastProfile,
	updateDebridLinkCastSettings,
} from '@/utils/debridLinkCastApiClient';
import { defaultEpisodeSize, defaultMovieSize, defaultOtherStreamsLimit } from '@/utils/settings';
import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useDebridLinkCredential } from './auth';
import useLocalStorage from './localStorage';

interface UseDebridLinkCastTokenOptions {
	/**
	 * Create the cast profile when there isn't one yet. Only the DMM Cast page
	 * should do this: enrolling costs a Debrid-Link call with the member's
	 * credential. Everywhere else the hook resyncs an existing profile and
	 * nothing more.
	 */
	enroll?: boolean;
}

export function useDebridLinkCastToken({ enroll = false }: UseDebridLinkCastTokenOptions = {}) {
	const token = useDebridLinkCredential();
	// Only a device-flow login has one. Read straight from storage rather than
	// through a hook so a token-paste member simply has none to send.
	const [refreshToken] = useLocalStorage<string>('dl:refreshToken');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('dl:castToken');
	// The credential the stored profile was last written with. Lets us tell
	// "settings drifted" (free to fix) from "the member re-authenticated"
	// (needs a call).
	const [syncedToken, setSyncedToken] = useLocalStorage<string>('dl:castSyncedKey');
	const inFlight = useRef(false);
	// Credential we have already synced on this mount. Writing the two
	// localStorage values below re-runs this effect, and without this it would
	// sync twice - and a wasted Debrid-Link call is a step towards an hour-long
	// endpoint lockout.
	const doneForKey = useRef<string | null>(null);

	useEffect(() => {
		if (!token) return;

		// Nothing to resync and not our place to enrol: stay off the network
		// entirely, which is the case for the vast majority of page views.
		if (!dmmCastToken && !enroll) return;

		if (inFlight.current || doneForKey.current === token) return;
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

				// A credential we have never synced has to go through the full save
				// so the server stores the current one; otherwise the addon would
				// keep streaming against a token the member has already replaced.
				const keyIsCurrent = !!dmmCastToken && syncedToken === token;

				let castToken: string | null = dmmCastToken ?? null;
				if (keyIsCurrent) {
					const ok = await updateDebridLinkCastSettings(dmmCastToken, settings);
					if (!ok)
						castToken = await saveDebridLinkCastProfile(token, settings, refreshToken);
				} else {
					castToken = await saveDebridLinkCastProfile(token, settings, refreshToken);
				}

				// Left unset on failure so a later render can retry.
				if (!castToken) return;
				doneForKey.current = token;

				if (castToken !== dmmCastToken) setDmmCastToken(castToken);
				if (token !== syncedToken) setSyncedToken(token);
			} catch (error) {
				toast.error('Failed to initialize DMM Cast for Debrid-Link.');
			} finally {
				inFlight.current = false;
			}
		};

		sync();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [token, refreshToken, dmmCastToken, syncedToken, enroll]);

	return dmmCastToken;
}
