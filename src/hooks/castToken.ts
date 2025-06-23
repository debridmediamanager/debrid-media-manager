import { saveCastProfile } from '@/utils/castApiClient';
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import useLocalStorage from './localStorage';

export function useCastToken() {
	const [clientId] = useLocalStorage<string>('rd:clientId');
	const [clientSecret] = useLocalStorage<string>('rd:clientSecret');
	const [refreshToken] = useLocalStorage<string>('rd:refreshToken');
	const [accessToken] = useLocalStorage<string>('rd:accessToken');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('rd:castToken');

	useEffect(() => {
		// Only run if we don't have a token but have all required credentials
		if (!clientId || !clientSecret || !refreshToken || !accessToken) return;
		if (dmmCastToken) return;

		const fetchToken = async () => {
			try {
				const res = await fetch('/api/stremio/id?token=' + accessToken);
				const data = await res.json();
				if (data.status !== 'error') {
					saveCastProfile(clientId, clientSecret, refreshToken);
					setDmmCastToken(data.id);
				}
			} catch (error) {
				toast.error('failed to fetch DMM Cast token');
			}
		};

		fetchToken();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [accessToken, clientId, clientSecret, refreshToken, dmmCastToken]);

	return dmmCastToken;
}
