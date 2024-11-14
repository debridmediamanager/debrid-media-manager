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
				if (
					res.status === 'error' &&
					res.errorMessage === 'Request failed with status code 401'
				) {
					setDmmCastToken('default');
				} else {
					setDmmCastToken(res.id);
				}
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [token]);

	return dmmCastToken;
}
