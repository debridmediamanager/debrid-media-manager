import { notifyLocalStorageChange } from '@/hooks/localStorage';

export const clearRdKeys = () => {
	const prefix = 'rd:';
	const keysToRemove: string[] = [];

	for (let i = 0; i < window.localStorage.length; i++) {
		const key = window.localStorage.key(i);
		if (key && key.startsWith(prefix)) {
			keysToRemove.push(key);
		}
	}

	keysToRemove.forEach((key) => {
		window.localStorage.removeItem(key);
		// Without this every useLocalStorage instance keeps serving the token it
		// read before the clear - this path does not reload the page afterwards
		notifyLocalStorageChange(key);
	});

	// Dispatch logout event to update UI immediately
	window.dispatchEvent(new Event('logout'));
};
