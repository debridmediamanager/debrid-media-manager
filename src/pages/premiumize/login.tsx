import useLocalStorage from '@/hooks/localStorage';
import { getPremiumizeAccountInfo, isPremiumizePremium } from '@/services/premiumize';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';

export default function PremiumizeLoginPage() {
	const router = useRouter();
	const [, setApiKey] = useLocalStorage<string>('pm:apiKey');
	const [inputApiKey, setInputApiKey] = useState('');
	const [error, setError] = useState('');
	const [checking, setChecking] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		setChecking(true);
		try {
			// Premiumize answers a missing, wrong and revoked key identically -
			// HTTP 200 with `authentication_failed` - so there is nothing more
			// specific to tell the user than "it did not work".
			const info = await getPremiumizeAccountInfo(inputApiKey.trim());
			if (!isPremiumizePremium(info)) {
				setError(
					'That key works, but the account is not premium. A free account can only resolve one link every two hours, behind a captcha.'
				);
				setChecking(false);
				return;
			}
			setApiKey(inputApiKey.trim());
			await router.replace(getSafeRedirectPath(router.query.redirect, '/'));
		} catch (err: any) {
			setError(
				err?.code === 'authentication_failed'
					? 'Premiumize rejected that key.'
					: `Could not validate API key: ${err?.message || 'unknown error'}`
			);
			setChecking(false);
		}
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center">
			<Head>
				<title>Debrid Media Manager - Premiumize Login</title>
			</Head>
			<div className="w-full max-w-md space-y-4 p-4">
				<h1 className="text-center text-2xl font-bold">Connect Premiumize</h1>
				{error && <p className="text-center text-red-500">{error}</p>}
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label htmlFor="apiKey" className="block text-sm font-medium">
							API Key
						</label>
						<input
							type="text"
							id="apiKey"
							value={inputApiKey}
							onChange={(e) => setInputApiKey(e.target.value)}
							className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							placeholder="Enter your Premiumize API key"
							required
						/>
					</div>
					<div className="flex flex-col space-y-2">
						<button
							type="submit"
							disabled={checking}
							className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
						>
							{checking ? 'Checking...' : 'Save API Key'}
						</button>
						<button
							type="button"
							onClick={() =>
								window.open('https://www.premiumize.me/account', '_blank')
							}
							className="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
						>
							Get API Key from Premiumize
						</button>
					</div>
				</form>
				<p className="text-center text-xs text-gray-400">
					Your key is stored in this browser and is sent to Premiumize through
					debridmediamanager.com, in a header - never in a URL.
				</p>
			</div>
		</div>
	);
}
