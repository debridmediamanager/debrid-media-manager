import { useState } from 'react';

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

	function setValueWithExpiry(newValue: T | ((prevState: T) => T), expiryTimeInSecs?: number) {
		const evaluatedValue =
			typeof newValue === 'function'
				? (newValue as (prevState: T) => T)(value || defaultValue!)
				: newValue;
		if (expiryTimeInSecs) {
			const expiryDate = new Date().getTime() + expiryTimeInSecs * 1000;
			const expirableValue: ExpirableValue<T> = {
				value: evaluatedValue,
				expiry: expiryDate,
			};
			localStorage.setItem(key, JSON.stringify(expirableValue));
		} else {
			localStorage.setItem(key, JSON.stringify(evaluatedValue));
		}
		setValue(() => evaluatedValue);
	}

	return [value, setValueWithExpiry] as const;
}

function isExpirableValue<T>(value: any): value is ExpirableValue<T> {
	return typeof value === 'object' && value !== null && 'value' in value && 'expiry' in value;
}

export default useLocalStorage;
