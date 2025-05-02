import { useState } from 'react';

type ExpirableValue<T> = {
	value: T;
	expiry: number;
};

function useLocalStorage<T>(
	key: string,
	defaultValue: T | null = null
): [T | null, (newValue: T | ((prevState: T | null) => T), expiryTimeInSecs?: number) => void] {
	const [storedValue, setStoredValue] = useState<T | null>(() => {
		if (typeof window === 'undefined') {
			// Running on the server, return the default value
			return defaultValue;
		}

		try {
			const item = window.localStorage.getItem(key);
			if (item) {
				const parsedItem = JSON.parse(item);
				if (isExpirableValue(parsedItem)) {
					const now = Date.now();
					if (parsedItem.expiry >= now) {
						// Log token-related expirable values
						if (key.includes('Token') || key.includes('token')) {
							console.log(`[localStorage] Reading ${key}`, {
								isExpirable: true,
								expiry: new Date(parsedItem.expiry).toISOString(),
								now: new Date(now).toISOString(),
								timeUntilExpiry: (parsedItem.expiry - now) / 1000, // in seconds
							});
						}
						return parsedItem.value;
					} else {
						if (key.includes('Token') || key.includes('token')) {
							console.log(`[localStorage] Removing expired ${key}`);
						}
						window.localStorage.removeItem(key);
						return defaultValue;
					}
				}
				return parsedItem;
			}
		} catch (error) {
			console.error('Error reading localStorage key “' + key + '”: ', error);
			return defaultValue;
		}
		return defaultValue;
	});

	const setValue = (newValue: T | ((prevState: T | null) => T), expiryTimeInSecs?: number) => {
		const valueToStore: T = newValue instanceof Function ? newValue(storedValue) : newValue;

		setStoredValue(valueToStore);

		if (expiryTimeInSecs) {
			const expiryDate = Date.now() + expiryTimeInSecs * 1000;
			const expirableValue: ExpirableValue<T> = {
				value: valueToStore,
				expiry: expiryDate,
			};
			if (key.includes('Token') || key.includes('token')) {
				console.log(`[localStorage] Setting ${key} with expiry`, {
					expiryTimeInSecs,
					expiryDate: new Date(expiryDate).toISOString(),
				});
			}
			window.localStorage.setItem(key, JSON.stringify(expirableValue));
		} else if (valueToStore !== null) {
			if (key.includes('Token') || key.includes('token')) {
				console.log(`[localStorage] Setting ${key} without expiry`);
			}
			window.localStorage.setItem(key, JSON.stringify(valueToStore));
		}
	};

	return [storedValue, setValue];
}

function isExpirableValue<T>(value: any): value is ExpirableValue<T> {
	return typeof value === 'object' && value !== null && 'expiry' in value && 'value' in value;
}

export default useLocalStorage;
