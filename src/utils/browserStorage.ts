export const getLocalStorageItem = (key: string): string | null => {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
};

export const getLocalStorageItemOrDefault = (key: string, fallback: string): string => {
	const value = getLocalStorageItem(key);
	return value ?? fallback;
};

export const getLocalStorageString = (key: string): string | null => {
	const value = getLocalStorageItem(key);
	if (value === null) return null;

	try {
		const parsed = JSON.parse(value);
		return typeof parsed === 'string' ? parsed : value;
	} catch {
		return value;
	}
};

export const getLocalStorageBoolean = (key: string, fallback: boolean): boolean => {
	const value = getLocalStorageItem(key);
	if (value === null) return fallback;
	return value === 'true';
};

/**
 * Whether releases Real-Debrid refuses by name are hidden by default.
 *
 * An explicit choice always wins. With no choice recorded the answer is "hide
 * them, but only for a user who has nowhere else to take them" - a user signed
 * in to a second service can still add the release there, so hiding it from
 * them would be removing an option they have.
 *
 * **This lives here because it was copied three times and the copies drifted.**
 * The settings toggle, the movie search page and the season page each carried
 * their own version of the rule; adding Premiumize extended one of them, and
 * adding Offcloud and Debrid-Link would have extended the same one again. The
 * result is a checkbox that reads unchecked while the pages behave as though it
 * were checked - the two disagree about what "default" means, which is worse
 * than either answer. One function, three callers, no room to drift.
 */
export const hideRdBlockedTorrentsDefault = (fallback: boolean): boolean => {
	if (typeof window === 'undefined') return fallback;

	const stored = getLocalStorageItem('settings:hideRdBlockedTorrents');
	if (stored !== null) return stored === 'true';

	const hasRd = !!getLocalStorageItem('rd:accessToken');
	const hasAd = !!getLocalStorageItem('ad:apiKey');
	const hasTb = !!getLocalStorageItem('tb:apiKey');
	const hasPm = !!getLocalStorageItem('pm:accessToken') || !!getLocalStorageItem('pm:apiKey');
	const hasOc = !!getLocalStorageItem('oc:apiKey');
	const hasDl = !!getLocalStorageItem('dl:accessToken') || !!getLocalStorageItem('dl:apiKey');

	return hasRd && !hasAd && !hasTb && !hasPm && !hasOc && !hasDl;
};
