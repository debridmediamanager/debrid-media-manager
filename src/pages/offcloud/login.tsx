import useLocalStorage from '@/hooks/localStorage';
import { getOffcloudAccountInfo, isOffcloudPremium } from '@/services/offcloud';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';

/**
 * Offcloud has no OAuth of any kind - the key from the account page is the only
 * credential, and it is the whole account (no scoping, no per-app keys). So
 * this page is the paste form alone, with none of the device-code half the
 * Premiumize page carries.
 */
export default function OffcloudLoginPage() {
	const router = useRouter();
	const [, setApiKey] = useLocalStorage<string>('oc:apiKey');
	const [inputApiKey, setInputApiKey] = useState('');
	const [error, setError] = useState('');
	const [checking, setChecking] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		setChecking(true);
		try {
			// Offcloud answers a missing, malformed and revoked key with the same
			// 401 `NOAUTH`, so there is nothing more specific to tell the user
			// than "it did not work".
			const info = await getOffcloudAccountInfo(inputApiKey.trim());
			if (!isOffcloudPremium(info)) {
				setError(
					'That key works, but the account is not premium. Offcloud only serves cached torrents to a premium account.'
				);
				setChecking(false);
				return;
			}
			setApiKey(inputApiKey.trim());
			await router.replace(getSafeRedirectPath(router.query.redirect, '/'));
		} catch (err: any) {
			setError(
				err?.code === 'NOAUTH'
					? 'Offcloud rejected that key.'
					: `Could not validate API key: ${err?.message || 'unknown error'}`
			);
			setChecking(false);
		}
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center">
			<Head>
				<title>Debrid Media Manager - Offcloud Login</title>
			</Head>
			<div className="w-full max-w-md space-y-4 p-4">
				<h1 className="text-center text-2xl font-bold">Connect Offcloud</h1>
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
							placeholder="Enter your Offcloud API key"
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
							onClick={() => window.open('https://offcloud.com/#/account', '_blank')}
							className="rounded border-2 border-[#f97316] bg-[#f97316]/30 px-4 py-2 text-orange-100 transition-colors hover:bg-[#f97316]/50"
						>
							Get API Key from Offcloud
						</button>
					</div>
				</form>
				<p className="text-center text-xs text-gray-400">
					Your Offcloud key is stored in this browser only. It is the whole account, so
					treat it like a password: anyone holding it can spend the account.
				</p>
			</div>
		</div>
	);
}
