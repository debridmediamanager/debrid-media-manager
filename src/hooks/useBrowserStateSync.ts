import { BrowserState, isSyncedKey, SYNC_ENABLED_KEY } from '@/utils/browserStateKeys';
import {
	applyState,
	collectState,
	fetchBrowserState,
	saveBrowserState,
	syncIdentities,
} from '@/utils/browserStateSync';
import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';

/** Set only after a completed restore (including no saved state). Per browser, never synced. */
export const RESTORE_TRIED_KEY = 'dmm:syncRestoreTried';
/** Keeps a failed first-login restore retryable across navigation and reloads. */
const RESTORE_PENDING_KEY = 'dmm:syncRestorePending';
const PUSH_DELAY_MS = 1500;
/** Rewritten by the token refreshers (`writeAccessToken`) without the login changing. */
const REFRESHED_KEYS = ['rd:accessToken', 'dl:accessToken', 'dl:tokenExpiry'];

/**
 * "Remember my logins and settings across devices". The first provider login
 * in a browser asks the server for the state saved behind it and fills in the
 * rest; while the setting is on, every change to a synced key is saved back.
 *
 * ponytail: no pull after that first restore, so two browsers changing things
 * at once end with whichever saved last. Merge per key on the server if that bites.
 */
export function useBrowserStateSync(): void {
	// Refs, not effect locals, so a remounted effect cannot start a second restore.
	const restoreStarted = useRef(false);
	const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		const push = () => {
			if (localStorage.getItem(SYNC_ENABLED_KEY) !== 'true') return;
			// Before its restore has answered, a browser's state is only the login it just
			// made, and saving that would replace the full state it is about to fetch.
			if (!localStorage.getItem(RESTORE_TRIED_KEY)) return;
			const identities = syncIdentities();
			if (identities.length) void saveBrowserState(identities, collectState());
		};
		const schedulePush = () => {
			clearTimeout(pushTimer.current);
			pushTimer.current = setTimeout(push, PUSH_DELAY_MS);
		};

		const restore = async () => {
			if (restoreStarted.current || localStorage.getItem(RESTORE_TRIED_KEY)) return;
			const [identity] = syncIdentities();
			if (!identity) return;
			restoreStarted.current = true;
			localStorage.setItem(RESTORE_PENDING_KEY, '1');
			let state: BrowserState | null;
			try {
				state = await fetchBrowserState(identity);
			} catch {
				// No answer, so not tried: the next login event asks again.
				restoreStarted.current = false;
				return;
			}
			localStorage.setItem(RESTORE_TRIED_KEY, '1');
			localStorage.removeItem(RESTORE_PENDING_KEY);
			if (state) {
				applyState(state);
				toast.success('Welcome back: your logins and settings were restored');
			}
			// Saves this browser's row under its own logins; a no-op unless the setting is on.
			schedulePush();
		};

		// Only this tab's writes: every tab runs this hook, so reacting to another
		// tab's native storage event would repeat that tab's restore and push.
		const onChange = (e: Event) => {
			const key = (e as CustomEvent<{ key?: string }>).detail?.key;
			if (!key || !isSyncedKey(key)) return;
			void restore();
			// A refreshed access token is the same login, not a change worth a save
			// (and its six provider checks) every hour; it still rides along in the next one.
			if (!REFRESHED_KEYS.includes(key)) schedulePush();
		};

		// A login already here at mount predates this hook: an established browser,
		// with nothing to restore. Asking anyway would send every logged-in
		// browser's credential (and a Real-Debrid token mint) right after a deploy.
		if (
			!localStorage.getItem(RESTORE_TRIED_KEY) &&
			!localStorage.getItem(RESTORE_PENDING_KEY) &&
			syncIdentities().length
		) {
			localStorage.setItem(RESTORE_TRIED_KEY, '1');
		}
		if (localStorage.getItem(RESTORE_PENDING_KEY)) void restore();
		window.addEventListener('local-storage', onChange);
		return () => {
			window.removeEventListener('local-storage', onChange);
			clearTimeout(pushTimer.current);
		};
	}, []);
}
