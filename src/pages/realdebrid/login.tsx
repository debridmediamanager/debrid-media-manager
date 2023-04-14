import useLocalStorage from '@/hooks/localStorage';
import { getCredentials, getDeviceCode, getToken } from '@/services/realDebrid';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';

export default function RealDebridLoginPage() {
	const [verificationUrl, setVerificationUrl] = useState('');
	const intervalId = useRef<number | null>(null);
	const [userCode, setUserCode] = useState('');
	const router = useRouter();
	const [clientId, setClientId] = useLocalStorage<string>('clientId');
	const [clientSecret, setClientSecret] = useLocalStorage<string>('clientSecret');
	const [refreshToken, setRefreshToken] = useLocalStorage<string>('refreshToken');
	const [accessToken, setAccessToken] = useLocalStorage<string>('accessToken');
	const [isCopied, setIsCopied] = useState(false);

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
					setIsCopied(true);
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
		const fetchAccessToken = async () => {
			// Refresh token is available, so try to get new tokens
			const response = await getToken(clientId!, clientSecret!, refreshToken!);
			if (response) {
				// New tokens obtained, save them and return authenticated
				const { access_token, expires_in } = response;
				setAccessToken(access_token, expires_in);
			}
		};
		if (!accessToken && refreshToken && clientId && clientSecret) fetchAccessToken();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clientId, clientSecret, refreshToken]);

	useEffect(() => {
		(async () => {
			if (accessToken) {
				await router.push('/');
			}
		})();
	}, [accessToken, router]);

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

	return (
		<div className="flex flex-col items-center justify-center h-screen">
			<Head>
				<title>Debrid Media Manager - Real-Debrid Login</title>
			</Head>
			{userCode && (
				<p className="mb-4 text-lg font-bold">
					Please click the button and enter this code: <strong>{userCode}</strong>{' '}
					{isCopied && '(copied to clipboard)'}
				</p>
			)}
			<button
				className="px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-600"
				onClick={handleAuthorize}
			>
				Authorize Debrid Media Manager
			</button>
		</div>
	);
}
