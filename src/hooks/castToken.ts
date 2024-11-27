import { useEffect } from 'react';
import toast from 'react-hot-toast';
import useLocalStorage from './localStorage';

export function useCastToken() {
	const [accessToken] = useLocalStorage<string>('rd:accessToken');
	const [dmmCastToken, setDmmCastToken] = useLocalStorage<string>('rd:castToken');

	useEffect(() => {
		const fetchToken = async () => {
			if (dmmCastToken) return;

			try {
				const res = await fetch('/api/stremio/id?token=' + accessToken);
				const data = await res.json();
				if (data.status !== 'error') {
					setDmmCastToken(data.id);
				}
			} catch (error) {
				toast.error('failed to fetch DMM Cast token');
			}
		};

		fetchToken();
	}, [accessToken]);

	return dmmCastToken;
}
