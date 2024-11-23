import { useEffect } from 'react';
import { saveCastProfile } from '../utils/castApiClient';
import useLocalStorage from './localStorage';

export const DMM_CAST_TOKEN_KEY = 'dmmcast:0.0.3';

export function useCastToken() {
	const [clientId] = useLocalStorage<string>('rd:clientId');
	const [clientSecret] = useLocalStorage<string>('rd:clientSecret');
	const [refreshToken] = useLocalStorage<string>('rd:refreshToken');
	const [accessToken] = useLocalStorage<string>('rd:accessToken');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>(DMM_CAST_TOKEN_KEY);

	useEffect(() => {
		const fetchToken = async () => {
			if (!accessToken) {
				setDmmCastToken('default');
				return;
			}

			if (dmmCastToken) {
				if (clientId && clientSecret && refreshToken) {
					await saveCastProfile(dmmCastToken, clientId, clientSecret, refreshToken);
				}
				return;
			}

			try {
				const res = await fetch('/api/stremio/id?token=' + accessToken);
				const data = await res.json();

				if (data.status === 'error') {
					setDmmCastToken('default');
				} else {
					setDmmCastToken(data.id);
					if (clientId && clientSecret && refreshToken) {
						await saveCastProfile(data.id, clientId, clientSecret, refreshToken);
					}
				}
			} catch (error) {
				setDmmCastToken('default');
			}
		};

		fetchToken();
	}, [accessToken]);

	return dmmCastToken;
}
