import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { saveCastProfile } from '../utils/castApiClient';
import useLocalStorage from './localStorage';

export const DMM_CAST_TOKEN_KEY = 'dmmcast:0.0.4';

export function useCastToken() {
	const [clientId] = useLocalStorage<string>('rd:clientId');
	const [clientSecret] = useLocalStorage<string>('rd:clientSecret');
	const [refreshToken] = useLocalStorage<string>('rd:refreshToken');
	const [accessToken] = useLocalStorage<string>('rd:accessToken');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>(DMM_CAST_TOKEN_KEY);

	useEffect(() => {
		const fetchToken = async () => {
			if (!accessToken) {
				return;
			}

			if (dmmCastToken && dmmCastToken !== 'default') {
				if (clientId && clientSecret && refreshToken) {
					await saveCastProfile(dmmCastToken, clientId, clientSecret, refreshToken);
				}
				return;
			}

			try {
				const res = await fetch('/api/stremio/id?token=' + accessToken);
				const data = await res.json();
				if (data.status !== 'error') {
					setDmmCastToken(data.id);
					if (clientId && clientSecret && refreshToken) {
						await saveCastProfile(data.id, clientId, clientSecret, refreshToken);
					}
				}
			} catch (error) {
				toast.error('failed to fetch DMM Cast token');
			}
		};

		fetchToken();
	}, [accessToken]);

	return dmmCastToken;
}
