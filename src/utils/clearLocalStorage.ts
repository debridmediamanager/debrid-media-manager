export const clearRdKeys = () => {
	const prefix = 'rd:';
	for (let i = 0; i < window.localStorage.length; i++) {
		const key = window.localStorage.key(i);
		if (key && key.startsWith(prefix)) {
			window.localStorage.removeItem(key);
		}
	}
};
