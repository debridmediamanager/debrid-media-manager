import {
	getCredentials,
	getCurrentUser as getRealDebridUser,
	getDeviceCode,
	getToken,
} from '@/api/realDebrid';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import useLocalStorage from './localStorage';

interface User {
	id: number;
	username: string;
	email: string;
	points: number;
	locale: string;
	avatar: string;
	type: 'premium' | 'free';
	premium: number;
	expiration: string;
}

export const useDebridLogin = () => {
	const router = useRouter();

	const loginWithRealDebrid = async () => {
		await router.push('/realdebrid/login');
	};

	const loginWithPremiumize = async () => {
		await router.push('/premiumize/login');
	};

	const loginWithAllDebrid = async () => {
		await router.push('/alldebrid/login');
	};

	const loginWithDebridLink = async () => {
		await router.push('/debridlink/login');
	};

	const loginWithPutIo = async () => {
		await router.push('/putio/login');
	};

	return {
		loginWithRealDebrid,
		loginWithPremiumize,
		loginWithAllDebrid,
		loginWithDebridLink,
		loginWithPutIo,
	};
};

export const useRealDebridAuthorization = () => {
	const [verificationUrl, setVerificationUrl] = useState('');
	const intervalId = useRef<number | null>(null);
	const [userCode, setUserCode] = useState('');
	const router = useRouter();
	const [clientId, setClientId] = useLocalStorage<string>('clientId');
	const [clientSecret, setClientSecret] = useLocalStorage<string>('clientSecret');
	const [refreshToken, setRefreshToken] = useLocalStorage<string>('refreshToken');
	const [accessToken, _] = useLocalStorage<string>('accessToken');

	useEffect(() => {
		const fetchDeviceCode = async () => {
			const deviceCodeResponse = await getDeviceCode();
			if (deviceCodeResponse) {
				setVerificationUrl(deviceCodeResponse.verification_url);
				setUserCode(deviceCodeResponse.user_code);

				// Save user code to clipboard
				try {
					await navigator.clipboard.writeText(deviceCodeResponse.user_code);
				} catch (error) {
					console.error('Error saving user code to clipboard:', (error as any).message);
				}

				const interval = deviceCodeResponse.interval * 1000;
				setRefreshToken(deviceCodeResponse.device_code);

				const checkAuthorization = async () => {
					const credentialsResponse = await getCredentials(
						deviceCodeResponse.device_code
					);
					if (credentialsResponse) {
						setClientId(credentialsResponse.client_id);
						setClientSecret(credentialsResponse.client_secret);
						clearInterval(intervalId.current!);
					}
				};

				const id = setInterval(checkAuthorization, interval) as any as number;
				intervalId.current = id;
			}
		};
		if (!clientId || !clientSecret || !refreshToken) fetchDeviceCode();

		return () => {
			clearInterval(intervalId.current!);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router]);

	useEffect(() => {
		(async () => {
			if (accessToken) {
				await router.push('/');
			}
		})();
	}, [accessToken, router]);

	const handleAuthorize = () => {
		if (verificationUrl) {
			window.open(verificationUrl, '_blank');
		}
	};

	return { userCode, handleAuthorize };
};

export const useRealDebridAccessToken = () => {
	const [clientId] = useLocalStorage<string>('clientId');
	const [clientSecret] = useLocalStorage<string>('clientSecret');
	const [refreshToken] = useLocalStorage<string>('refreshToken');
	const [accessToken, setAccessToken] = useLocalStorage<string>('accessToken');

	useEffect(() => {
		(async () => {
			if (!accessToken && refreshToken && clientId && clientSecret) {
				// Refresh token is available, so try to get new tokens
				const response = await getToken(clientId, clientSecret, refreshToken);
				if (response) {
					// New tokens obtained, save them and return authenticated
					const { access_token, expires_in } = response;
					setAccessToken(access_token, expires_in);
				}
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clientId, clientSecret, refreshToken]);

	return accessToken;
};

export const useCurrentUser = () => {
	const [user, setUser] = useState<User | null>(null);
	const router = useRouter();
	const [accessToken] = useLocalStorage<string>('accessToken');

	useEffect(() => {
		(async () => {
			if (!accessToken) return null;
			const rdUser = await getRealDebridUser(accessToken);
			if (rdUser) setUser(<User>rdUser);
		})();
	}, [accessToken, router]);

	return user;
};
