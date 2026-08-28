import useLocalStorage from '@/hooks/localStorage';
import { getCredentials, getCurrentUser, getDeviceCode, getToken } from '@/services/realDebrid';
import type { DeviceCodeResponse } from '@/services/types';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function RealDebridLoginPage() {
	const router = useRouter();
	const [, setClientId] = useLocalStorage<string>('rd:clientId');
	const [, setClientSecret] = useLocalStorage<string>('rd:clientSecret');
	const [, setRefreshToken] = useLocalStorage<string>('rd:refreshToken');
	const [, setAccessToken] = useLocalStorage<string>('rd:accessToken');
	const [inputApiKey, setInputApiKey] = useState('');
	const [error, setError] = useState('');
	const [checking, setChecking] = useState(false);
	const [device, setDevice] = useState<DeviceCodeResponse | null>(null);
	const [isCopied, setIsCopied] = useState(false);
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
	 * Device-code login. Started by a click rather than on mount, because this
	 * page also takes a pasted API token: a device code nobody is going to
	 * approve is a code minted and polled for nothing.
	 */
	const startDeviceLogin = async () => {
		setError('');
		setChecking(true);
		try {
			const code = await getDeviceCode();
			setDevice(code);
			// The device code doubles as the refresh token in Real-Debrid's flow,
			// and hooks/auth reads it back from here to renew the 24h access
			// token, so it has to be stored before the exchange - not after.
			setRefreshToken(code.device_code);

			try {
				await navigator.clipboard.writeText(code.user_code);
				setIsCopied(true);
			} catch {
				// Blocked outside a user gesture in some browsers - the code is on
				// screen either way, so this is not worth surfacing.
			}

			const deadline = Date.now() + code.expires_in * 1000;
			while (!cancelled.current && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, code.interval * 1000));
				if (cancelled.current) return;
				// Real-Debrid answers an unapproved code with an error rather than
				// a pending marker, so a failed poll is the normal case here and
				// must not end the loop.
				const credentials = await getCredentials(code.device_code).catch(() => null);
				if (!credentials?.client_id) continue;

				setClientId(credentials.client_id);
				setClientSecret(credentials.client_secret);
				const { access_token, expires_in } = await getToken(
					credentials.client_id,
					credentials.client_secret,
					code.device_code
				);
				setAccessToken(access_token, expires_in);
				await finish();
				return;
			}
			if (!cancelled.current) {
				setError('That code expired before it was approved. Try again.');
				setDevice(null);
				setChecking(false);
			}
		} catch (err: any) {
			if (cancelled.current) return;
			setError(`Could not sign in: ${err?.message || 'unknown error'}`);
			setDevice(null);
			setChecking(false);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		setChecking(true);
		try {
			// A private API token is a bearer token for the same REST API the
			// device flow ends at, so it goes in the same place - but without an
			// expiry, because there are no OAuth credentials to renew it with.
			await getCurrentUser(inputApiKey.trim());
			setAccessToken(inputApiKey.trim());
			await finish();
		} catch (err: any) {
			const status = err?.response?.status;
			setError(
				status === 401 || status === 403
					? 'Real-Debrid rejected that API key.'
					: `Could not validate API key: ${err?.message || 'unknown error'}`
			);
			setChecking(false);
		}
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center">
			<Head>
				<title>Debrid Media Manager - Real-Debrid Login</title>
			</Head>
			<div className="w-full max-w-md space-y-4 p-4">
				<h1 className="text-center text-2xl font-bold">Connect Real-Debrid</h1>
				{error && <p className="text-center text-red-500">{error}</p>}

				{device ? (
					<div className="space-y-3 rounded-md border-2 border-[#aa0000] bg-[#aa0000]/20 p-4 text-center">
						<p className="text-sm">Enter this code on Real-Debrid to finish:</p>
						<p
							className="select-all font-mono text-3xl font-bold tracking-widest"
							data-testid="rd-user-code"
						>
							{device.user_code}
						</p>
						{/* Posting the code rather than linking it fills the form in
						    for the user, which is the whole point of the button. */}
						<form method="post" action={device.verification_url} target="_blank">
							<input type="hidden" name="usercode" value={device.user_code} />
							<input type="hidden" name="action" value="Continue" />
							<button
								type="submit"
								className="inline-block rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
							>
								Open {device.verification_url.replace(/^https?:\/\//, '')}
							</button>
						</form>
						<p className="text-xs text-gray-400">
							{isCopied && 'Copied to your clipboard. '}Waiting for you to approve...
							this page finishes on its own.
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
							{checking ? 'Starting...' : 'Sign in with Real-Debrid'}
						</button>
						<p className="text-center text-xs text-gray-400">
							Signing in gives Debrid Media Manager its own credentials, which renew
							themselves and can be revoked from your Real-Debrid account. An API key
							does not expire and is not scoped to this app.
						</p>

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
									placeholder="Enter your Real-Debrid API key"
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
										window.open('https://real-debrid.com/apitoken', '_blank')
									}
									className="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
								>
									Get API Key from Real-Debrid
								</button>
							</div>
						</form>
					</>
				)}
			</div>
		</div>
	);
}
