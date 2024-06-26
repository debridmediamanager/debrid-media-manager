import { useEffect } from 'react';
import { useRealDebridAccessToken } from './auth';
import useLocalStorage from './localStorage';

export function useCastToken() {
	const [token] = useRealDebridAccessToken();
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('dmmcast:0.0.2');

	useEffect(() => {
		if (!token || dmmCastToken) return;
		fetch('/api/stremio/id?token=' + token)
			.then((res) => res.json())
			.then((res) => setDmmCastToken(res.id));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [token]);

	return dmmCastToken;
}
