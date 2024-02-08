import { useEffect } from 'react';
import { useRealDebridAccessToken } from './auth';
import useLocalStorage from './localStorage';

export function useCastToken() {
	const [token] = useRealDebridAccessToken();
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('dmmcast');

	useEffect(() => {
		if (!token || dmmCastToken) return;
		fetch('/api/dmmcast/magic/id?token=' + token)
			.then((res) => res.json())
			.then((res) => setDmmCastToken(res.id));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [token]);

	return dmmCastToken;
}
