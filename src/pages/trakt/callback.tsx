import useLocalStorage from '@/hooks/localStorage';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function TraktCallbackPage() {
	const router = useRouter();
	const [_, setRefreshToken] = useLocalStorage<string>('trakt:refreshToken');
	const [_2, setAccessToken] = useLocalStorage<string>('trakt:accessToken');
	const [erroMessage, setErrorMessage] = useState('');

	useEffect(() => {
		const { code } = router.query;
		if (!code) {
			return;
		}
		fetch(
			'/api/trakt/exchange?code=' +
				code +
				`&redirect=${window.location.origin}/trakt/callback`
		)
			.then((res) => res.json())
			.then((data) => {
				if (data.error) {
					setErrorMessage(`Error: ${data.error}, ${data.error_description}`);
					return;
				}
				setAccessToken(data.access_token, data.expires_in);
				setRefreshToken(data.refresh_token);
				router.push('/');
			})
			.catch((err) => setErrorMessage(err));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router]);

	return <>{erroMessage}</>;
}
