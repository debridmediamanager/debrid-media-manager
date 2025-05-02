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
					if (parsedItem.expiry >= Date.now()) {
						return parsedItem.value;
					} else {
						window.localStorage.removeItem(key);
						return defaultValue;
					}
				}
				return parsedItem;
			}
		} catch (error) {
			console.error('Error reading localStorage key "' + key + '": ', error);
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
			window.localStorage.setItem(key, JSON.stringify(expirableValue));
		} else if (valueToStore !== null) {
			window.localStorage.setItem(key, JSON.stringify(valueToStore));
		}
	};

	return [storedValue, setValue];
}

function isExpirableValue<T>(value: any): value is ExpirableValue<T> {
	return typeof value === 'object' && value !== null && 'expiry' in value && 'value' in value;
}

export default useLocalStorage;
