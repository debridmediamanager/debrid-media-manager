import useLocalStorage from '@/hooks/localStorage';
import { getPremiumizeAccountInfo, isPremiumizePremium } from '@/services/premiumize';
import {
	pollPremiumizeDeviceToken,
	requestPremiumizeDeviceCode,
	type PremiumizeDeviceCode,
} from '@/services/premiumizeOAuth';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function PremiumizeLoginPage() {
	const router = useRouter();
	const [, setApiKey] = useLocalStorage<string>('pm:apiKey');
	const [, setAccessToken] = useLocalStorage<string>('pm:accessToken');
	const [inputApiKey, setInputApiKey] = useState('');
	const [error, setError] = useState('');
	const [checking, setChecking] = useState(false);
	const [device, setDevice] = useState<PremiumizeDeviceCode | null>(null);
	const cancelled = useRef(false);

	useEffect(
		() => () => {
			cancelled.current = true;
		},
		[]
	);

	const finish = useCallback(
		async () => router.replace(getSafeRedirectPath(router.query.redirect, '/')),
		[router]
	);

	/**
	 * Device-code login. No redirect URI is involved, which is why this works
	 * identically on a self-hosted instance and on localhost.
	 */
	const startDeviceLogin = async () => {
		setError('');
		setChecking(true);
		try {
			const code = await requestPremiumizeDeviceCode();
			setDevice(code);

			// Premiumize dictates the interval and answers `slow_down` if we
			// poll faster; it expects the interval to grow when it does.
			let interval = code.interval;
			const deadline = Date.now() + code.expires_in * 1000;

			while (!cancelled.current && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, interval * 1000));
				if (cancelled.current) return;
				const token = await pollPremiumizeDeviceToken(code.device_code, () => {
					interval += 5;
				});
				if (token) {
					// Stored apart from pm:apiKey on purpose - the two are not
					// interchangeable, and only the API key opens WebDAV.
					setAccessToken(token.access_token);
					await finish();
					return;
				}
			}
			if (!cancelled.current) {
				setError('That code expired before it was approved. Try again.');
				setDevice(null);
				setChecking(false);
			}
		} catch (err: any) {
			if (cancelled.current) return;
			setError(
				err?.error === 'access_denied'
					? 'You declined the request on Premiumize.'
					: `Could not sign in: ${err?.message || 'unknown error'}`
			);
			setDevice(null);
			setChecking(false);
		}
	};

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
			await finish();
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

				{device ? (
					<div className="space-y-3 rounded-md border-2 border-[#aa0000] bg-[#aa0000]/20 p-4 text-center">
						<p className="text-sm">Enter this code on Premiumize to finish:</p>
						<p
							className="select-all font-mono text-3xl font-bold tracking-widest"
							data-testid="pm-user-code"
						>
							{device.user_code}
						</p>
						<a
							href={device.verification_uri}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-block rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
						>
							Open {device.verification_uri.replace(/^https?:\/\//, '')}
						</a>
						<p className="text-xs text-gray-400">
							Waiting for you to approve... this page finishes on its own.
						</p>
					</div>
				) : (
					<>
						<button
							type="button"
							onClick={startDeviceLogin}
							disabled={checking}
							className="w-full rounded border-2 border-[#aa0000] bg-[#aa0000]/30 px-4 py-2 text-red-100 transition-colors hover:bg-[#aa0000]/50 disabled:opacity-50"
						>
							{checking ? 'Starting...' : 'Sign in with Premiumize'}
						</button>

						<div className="flex items-center gap-2 text-xs text-gray-500">
							<span className="h-px flex-1 bg-gray-700" />
							or paste an API key
							<span className="h-px flex-1 bg-gray-700" />
						</div>

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
							Signing in grants Debrid Media Manager access to your Premiumize
							account. Unlike an API key, it cannot be used for WebDAV or Usenet, and
							you can revoke it from your Premiumize account at any time.
						</p>
					</>
				)}
			</div>
		</div>
	);
}
