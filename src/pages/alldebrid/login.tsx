import useLocalStorage from '@/hooks/localStorage';
import { checkPin, getPin } from '@/services/allDebrid';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

// Current limits are at 12 requests per second and 600 requests per minute.
// This is the pin auth flow

export default function AllDebridLoginPage() {
	const [pinCodeInputUrl, setPinCodeInputUrl] = useState('');
	const [pinCode, setPinCode] = useState('');
	const router = useRouter();
	const [apiKey, setApiKey] = useLocalStorage<string>('ad:apiKey');
	const [isCopied, setIsCopied] = useState(false);

	useEffect(() => {
		const fetchDeviceCode = async () => {
			const pinResponse = await getPin();
			if (pinResponse) {
				setPinCodeInputUrl(pinResponse.user_url);
				setPinCode(pinResponse.pin);

				// Save pin code to clipboard
				try {
					await navigator.clipboard.writeText(pinResponse.pin);
				} catch (error) {
					setIsCopied(true);
					console.error('Error saving pin code to clipboard:', (error as any).message);
				}

				const checkResponse = await checkPin(pinResponse.pin, pinResponse.check);
				if (checkResponse) {
					setApiKey(checkResponse.data.apikey!, 86400);
				}
			}
		};
		if (!apiKey) fetchDeviceCode();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router]);

	useEffect(() => {
		(async () => {
			if (apiKey) {
				await router.push('/');
			}
		})();
	}, [apiKey, router]);

	const handleAuthorize = () => {
		if (pinCodeInputUrl) {
			window.open(pinCodeInputUrl, '_blank');
		}
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center">
			<Head>
				<title>Debrid Media Manager - AllDebrid Login</title>
			</Head>
			{pinCode && (
				<p className="mb-4 text-lg font-bold">
					Please click the button and enter this code: <strong>{pinCode}</strong>{' '}
					{isCopied && '(copied to clipboard)'}
				</p>
			)}
			<button
				className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
				onClick={handleAuthorize}
			>
				Authorize Debrid Media Manager
			</button>
		</div>
	);
}
