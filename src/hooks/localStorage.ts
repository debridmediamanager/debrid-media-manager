import { useState, useEffect } from 'react';

type ExpirableValue<T> = {
	value: T;
	expiry: number;
};

function useLocalStorage<T>(key: string, defaultValue: T | null = null) {
	const [value, setValue] = useState<T | null>(() => {
		if (typeof window === 'undefined') {
			// Running on the server, return null
			return null;
		}

		const storedValue = localStorage.getItem(key);
		if (storedValue !== null) {
			const parsedValue = JSON.parse(storedValue) as ExpirableValue<T> | T;
			if (isExpirableValue(parsedValue)) {
				if (parsedValue.expiry >= new Date().getTime()) {
					return parsedValue.value;
				} else {
					localStorage.removeItem(key);
				}
			} else {
				return parsedValue;
			}
		}
		return defaultValue;
	});

	function setValueWithExpiry(newValue: T, expiryTimeInSecs?: number) {
		if (expiryTimeInSecs) {
			const expiryDate = new Date().getTime() + expiryTimeInSecs * 1000;
			const expirableValue: ExpirableValue<T> = { value: newValue, expiry: expiryDate };
			localStorage.setItem(key, JSON.stringify(expirableValue));
			setValue(newValue);
		} else {
			localStorage.setItem(key, JSON.stringify(newValue));
			setValue(newValue);
		}
	}

	return [value, setValueWithExpiry] as const;
}

function isExpirableValue<T>(value: any): value is ExpirableValue<T> {
	return typeof value === 'object' && value !== null && 'value' in value && 'expiry' in value;
}

export default useLocalStorage;
