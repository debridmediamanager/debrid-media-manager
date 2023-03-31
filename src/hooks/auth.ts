import { getCredentials, getCurrentUser, getDeviceCode, getToken } from '@/api/realDebrid';
import Cookies from 'js-cookie';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';

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

const saveClientCredentials = (clientId: string, clientSecret: string, deviceCode: string) => {
	Cookies.set('clientId', clientId);
	Cookies.set('clientSecret', clientSecret);
	Cookies.set('refreshToken', deviceCode);
};

export const useRealDebridLogin = () => {
	const router = useRouter();

	const handleLogin = async () => {
		await router.push('/realdebrid/login');
	};

	return { handleLogin };
};

export const useRealDebridAuthorization = () => {
	const [verificationUrl, setVerificationUrl] = useState('');
	const intervalId = useRef<number | null>(null);
	const [userCode, setUserCode] = useState('');
	const router = useRouter();

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
				const deviceCode = deviceCodeResponse.device_code;

				const checkAuthorization = async () => {
					const credentialsResponse = await getCredentials(deviceCode);
					if (credentialsResponse) {
						saveClientCredentials(
							credentialsResponse.client_id,
							credentialsResponse.client_secret,
							deviceCode
						);
						clearInterval(intervalId.current!);
						await router.push('/');
					}
				};

				const id = setInterval(checkAuthorization, interval) as any as number;
				intervalId.current = id;
			}
		};
		fetchDeviceCode();

		return () => {
			clearInterval(intervalId.current!);
		};
	}, [router]);

	const handleAuthorize = () => {
		if (verificationUrl) {
			window.open(verificationUrl, '_blank');
		}
	};

	return { userCode, handleAuthorize };
};

const saveTokens = (accessToken: string, refreshToken: string, expiresIn: number) => {
	Cookies.set('accessToken', accessToken, { expires: expiresIn / (60 * 60 * 24) }); // set the expiry time in days
	Cookies.set('refreshToken', refreshToken);
};

export const useRealDebridAccessToken = () => {
	const [accessToken, setAccessToken] = useState<string>('');

	useEffect(() => {
		(async () => {
			const accessToken = Cookies.get('accessToken');
			if (accessToken) {
				setAccessToken(accessToken);
			}

			const refreshToken = Cookies.get('refreshToken');
			const clientId = Cookies.get('clientId');
			const clientSecret = Cookies.get('clientSecret');
			if (refreshToken && clientId && clientSecret) {
				// Refresh token is available, so try to get new tokens
				const response = await getToken(clientId, clientSecret, refreshToken);
				if (response) {
					// New tokens obtained, save them and return authenticated
					const { access_token, refresh_token, expires_in } = response;
					saveTokens(access_token, refresh_token, expires_in);
					setAccessToken(access_token);
				}
			}
		})();
	}, []);

	return accessToken;
};

export const useRealDebridCurrentUser = (loginRoute: string) => {
	const [user, setUser] = useState<User | null>(null);
	const router = useRouter();

	useEffect(() => {
		(async () => {
			const authenticated = await isAuthenticated();
			if (!authenticated) {
				await router.push(loginRoute);
			} else {
				const accessToken = Cookies.get('accessToken');
				const currentUser = await getCurrentUser(accessToken!);
				if (currentUser) {
					setUser(<User>currentUser);
				}
			}
		})();
	}, [router, loginRoute]);

	return user;
};

const isAuthenticated = async () => {
	const accessToken = Cookies.get('accessToken');
	if (accessToken) {
		// Access token is already set, so user is authenticated
		return true;
	}

	const refreshToken = Cookies.get('refreshToken');
	const clientId = Cookies.get('clientId');
	const clientSecret = Cookies.get('clientSecret');

	if (refreshToken && clientId && clientSecret) {
		// Refresh token is available, so try to get new tokens
		const response = await getToken(clientId, clientSecret, refreshToken);
		if (response) {
			// New tokens obtained, save them and return authenticated
			const { access_token, refresh_token, expires_in } = response;
			saveTokens(access_token, refresh_token, expires_in);
			return true;
		}
	}

	// User is not authenticated
	return false;
};
