import useLocalStorage from '@/hooks/localStorage';
import { getDebridLinkAccountInfo, isDebridLinkPremium } from '@/services/debridLink';
import {
	deviceVerificationUri,
	pollDebridLinkDeviceToken,
	requestDebridLinkDeviceCode,
	type DebridLinkDeviceCode,
} from '@/services/debridLinkOAuth';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function DebridLinkLoginPage() {
	const router = useRouter();
	const [, setApiKey] = useLocalStorage<string>('dl:apiKey');
	const [, setAccessToken] = useLocalStorage<string>('dl:accessToken');
	const [, setRefreshToken] = useLocalStorage<string>('dl:refreshToken');
	const [, setTokenExpiry] = useLocalStorage<number>('dl:tokenExpiry');
	const [inputApiKey, setInputApiKey] = useState('');
	const [error, setError] = useState('');
	const [checking, setChecking] = useState(false);
	const [device, setDevice] = useState<DebridLinkDeviceCode | null>(null);
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
			const code = await requestDebridLinkDeviceCode();
			setDevice(code);

			// Debrid-Link dictates the interval and answers `slow_down` if we
			// poll faster; it expects the interval to grow when it does.
			let interval = code.interval;
			const deadline = Date.now() + code.expires_in * 1000;

			while (!cancelled.current && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, interval * 1000));
				if (cancelled.current) return;
				const token = await pollDebridLinkDeviceToken(code.device_code, () => {
					interval += 5;
				});
				if (token) {
					// Stored apart from dl:apiKey on purpose: the pasted token
					// is the whole account, this one carries only the scopes
					// DMM asked for and can be revoked on its own.
					setAccessToken(token.access_token);
					// The real lifetime is unmeasured (see debridLinkOAuth.ts).
					// Recording an absolute expiry costs nothing and is what
					// lets `useDebridLink` renew lazily instead of guessing; if
					// Debrid-Link sends neither field, nothing is stored and
					// nothing tries to refresh.
					if (token.refresh_token) setRefreshToken(token.refresh_token);
					if (typeof token.expires_in === 'number') {
						setTokenExpiry(Date.now() + token.expires_in * 1000);
					}
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
					? 'You declined the request on Debrid-Link.'
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
			// Debrid-Link answers an absent, malformed and revoked token with
			// the same 401 `badToken`, so there is nothing more specific to
			// tell the user than "it did not work".
			const info = await getDebridLinkAccountInfo(inputApiKey.trim());
			if (!isDebridLinkPremium(info)) {
				setError(
					'That token works, but the account is not premium. The Debrid-Link seedbox is a premium feature.'
				);
				setChecking(false);
				return;
			}
			setApiKey(inputApiKey.trim());
			// `useDebridLinkCredential` prefers the access token, so a stale one
			// left here outranks the token just validated and nothing sent from
			// this browser would use it - the login reports success while every
			// page keeps failing. The refresh pair goes with it, or it mints a
			// replacement access token that wins again. Only after acceptance.
			setAccessToken(null);
			setRefreshToken(null);
			setTokenExpiry(null);
			await finish();
		} catch (err: any) {
			setError(
				err?.code === 'badToken'
					? 'Debrid-Link rejected that token.'
					: `Could not validate API token: ${err?.message || 'unknown error'}`
			);
			setChecking(false);
		}
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center">
			<Head>
				<title>Debrid Media Manager - Debrid-Link Login</title>
			</Head>
			<div className="w-full max-w-md space-y-4 p-4">
				<h1 className="text-center text-2xl font-bold">Connect Debrid-Link</h1>
				{error && <p className="text-center text-red-500">{error}</p>}

				{device ? (
					<div className="space-y-3 rounded-md border-2 border-[#38bdf8] bg-[#38bdf8]/20 p-4 text-center">
						<p className="text-sm">Enter this code on Debrid-Link to finish:</p>
						<p
							className="select-all font-mono text-3xl font-bold tracking-widest"
							data-testid="dl-user-code"
						>
							{device.user_code}
						</p>
						<a
							href={deviceVerificationUri(device)}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-block rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
						>
							Open {deviceVerificationUri(device).replace(/^https?:\/\//, '')}
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
							className="w-full rounded border-2 border-[#38bdf8] bg-[#38bdf8]/30 px-4 py-2 text-sky-100 transition-colors hover:bg-[#38bdf8]/50 disabled:opacity-50"
						>
							{checking ? 'Starting...' : 'Sign in with Debrid-Link'}
						</button>

						<div className="flex items-center gap-2 text-xs text-gray-500">
							<span className="h-px flex-1 bg-gray-700" />
							or paste an API token
							<span className="h-px flex-1 bg-gray-700" />
						</div>

						<form onSubmit={handleSubmit} className="space-y-4">
							<div>
								<label htmlFor="apiKey" className="block text-sm font-medium">
									API Token
								</label>
								<input
									type="text"
									id="apiKey"
									value={inputApiKey}
									onChange={(e) => setInputApiKey(e.target.value)}
									className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
									placeholder="Enter your Debrid-Link API token"
									required
								/>
							</div>
							<div className="flex flex-col space-y-2">
								<button
									type="submit"
									disabled={checking}
									className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
								>
									{checking ? 'Checking...' : 'Save API Token'}
								</button>
								<button
									type="button"
									onClick={() =>
										window.open(
											'https://debrid-link.fr/webapp/apikey',
											'_blank'
										)
									}
									className="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
								>
									Get API Token from Debrid-Link
								</button>
							</div>
						</form>
						<p className="text-center text-xs text-gray-400">
							Signing in grants Debrid Media Manager access to your Debrid-Link
							account. Unlike a pasted API token, it is limited to what DMM asks for
							and you can revoke it from your Debrid-Link account at any time.
						</p>
					</>
				)}
			</div>
		</div>
	);
}
