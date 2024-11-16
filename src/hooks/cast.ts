import { useEffect } from 'react';
import { useRealDebridAccessToken } from './auth';
import useLocalStorage from './localStorage';

export const DMM_CAST_TOKEN_KEY = 'dmmcast:0.0.2';

export function useCastToken() {
	const [token] = useRealDebridAccessToken();
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>(DMM_CAST_TOKEN_KEY);

	useEffect(() => {
		if (!token) {
			setDmmCastToken('default');
			return;
		}
		fetch('/api/stremio/id?token=' + token)
			.then((res) => res.json())
			.then((res) => {
				if (res.status === 'error') {
					setDmmCastToken('default');
				} else {
					setDmmCastToken(res.id);
				}
			});
	}, [token]);

	return dmmCastToken;
}
